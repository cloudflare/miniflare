import assert from "assert";
import path from "path";
import {
  CacheError,
  CachePlugin,
  CacheStorage,
  CachedMeta,
  NoOpCache,
} from "@miniflare/cache";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  StoredValueMeta,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  TestLog,
  getObjectProperties,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
  useTmp,
  utf8Decode,
} from "@miniflare/shared-test";
import test from "ava";
import { File, FormData } from "undici";
import { testResponse } from "./helpers";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  globalAsyncIO: true,
  sharedCache: unusable(),
};

test("CacheStorage: provides default cache", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, log, factory, {});
  await caches.default.put("http://localhost:8787/", testResponse());
  const cached = await caches.default.match("http://localhost:8787/");
  t.is(await cached?.text(), "value");
});
test("CacheStorage: namespaced caches are separate from default cache and each other", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, log, factory, {});
  const cache2 = await caches.open("cache2");
  const cache3 = await caches.open("cache3");

  await caches.default.put("http://localhost:8787/", testResponse("1"));
  await cache2.put("http://localhost:8787/", testResponse("2"));
  await cache3.put("http://localhost:8787/", testResponse("3"));

  const cached1 = await caches.default.match("http://localhost:8787/");
  const cached2 = await cache2.match("http://localhost:8787/");
  const cached3 = await cache3.match("http://localhost:8787/");
  t.is(await cached1?.text(), "1");
  t.is(await cached2?.text(), "2");
  t.is(await cached3?.text(), "3");
});
test("CacheStorage: cannot create namespaced cache named default", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, log, factory, {});
  await t.throwsAsync(caches.open("default"), {
    instanceOf: CacheError,
    code: "ERR_RESERVED",
    message: '"default" is a reserved cache name',
  });
});
test("CacheStorage: persists cached data", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({ ["map:default"]: map });
  const caches = new CacheStorage({ cachePersist: "map" }, log, factory, {});
  await caches.default.put("http://localhost:8787/", testResponse());
  const cached = map.get("http://localhost:8787/");
  t.is(cached?.metadata?.status, 200);
  t.deepEqual(cached?.metadata?.headers, [
    ["cache-control", "max-age=3600"],
    ["content-type", "text/plain; charset=utf8"],
  ]);
  t.is(utf8Decode(cached?.value), "value");
});
test("CacheStorage: disables caching", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({ cache: false }, log, factory, {});
  await caches.default.put("http://localhost:8787/", testResponse());
  const cached = await caches.default.match("http://localhost:8787/");
  t.is(cached, undefined);
});
test("CacheStorage: warns once if caching disabled when deploying", async (t) => {
  const factory = new MemoryStorageFactory();
  const log = new TestLog();
  const warning =
    "Cache operations will have no impact if you deploy to a workers.dev subdomain!";

  let caches = new CacheStorage({ cacheWarnUsage: true }, log, factory, {});
  caches.default;
  t.deepEqual(log.logs, [[LogLevel.WARN, warning]]);
  log.logs = [];
  await caches.open("test");
  t.deepEqual(log.logs, []);

  caches = new CacheStorage({ cacheWarnUsage: true }, log, factory, {});
  await caches.open("test");
  t.deepEqual(log.logs, [[LogLevel.WARN, warning]]);
  log.logs = [];
  caches.default;
  t.deepEqual(log.logs, []);
});
test("CacheStorage: hides implementation details", (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, log, factory, {});
  t.deepEqual(getObjectProperties(caches), ["default", "open"]);
});

test("CachePlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(CachePlugin, [
    "--cache-persist",
    "path",
    "--no-cache",
  ]);
  t.deepEqual(options, { cachePersist: "path", cache: false });
  options = parsePluginArgv(CachePlugin, ["--cache-persist"]);
  t.deepEqual(options, { cachePersist: true });
});
test("CachePlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(CachePlugin, {
    workers_dev: true,
    miniflare: { cache: false, cache_persist: "path" },
  });
  t.deepEqual(options, {
    cache: false,
    cachePersist: "path",
    cacheWarnUsage: true,
  });
});
test("CachePlugin: logs options", (t) => {
  const logs = logPluginOptions(CachePlugin, {
    cache: false,
    cachePersist: "path",
  });
  t.deepEqual(logs, ["Cache: false", "Cache Persistence: path"]);
});

test("CachePlugin: setup: includes CacheStorage in globals", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({ ["test://map:default"]: map });

  let plugin = new CachePlugin(ctx, { cachePersist: "test://map" });
  let result = plugin.setup(factory);
  let caches = result.globals?.caches;
  t.true(caches instanceof CacheStorage);
  assert(caches instanceof CacheStorage);
  t.is(caches, plugin.getCaches());
  await caches.default.put("http://localhost:8787/", testResponse());
  t.true(map.has("http://localhost:8787/"));

  plugin = new CachePlugin(ctx, { cache: false });
  result = plugin.setup(factory);
  caches = result.globals?.caches;
  t.true(caches instanceof CacheStorage);
  assert(caches instanceof CacheStorage);
  t.true(caches.default instanceof NoOpCache);
  t.true((await caches.open("test")) instanceof NoOpCache);
});
test("CachePlugin: setup: resolves persist path relative to rootPath", async (t) => {
  const tmp = await useTmp(t);
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({
    [`${tmp}${path.sep}test:default`]: map,
  });

  const plugin = new CachePlugin(
    { ...ctx, rootPath: tmp },
    { cachePersist: "test" }
  );
  plugin.setup(factory);
  const caches = plugin.getCaches();
  await caches.default.put("http://localhost:8787/", testResponse());
  t.true(map.has("http://localhost:8787/"));
});
test("CachePlugin: setup: Responses parse files in FormData as File objects only if compatibility flag enabled", async (t) => {
  const factory = new MemoryStorageFactory();
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  let plugin = new CachePlugin(ctx);
  let caches: CacheStorage = plugin.setup(factory).globals?.caches;
  await caches.default.put("http://localhost", testResponse(formData));
  let cache = await caches.open("test");
  await cache.put("http://localhost", testResponse(formData));

  let res = await caches.default.match("http://localhost");
  t.is((await res?.formData())?.get("file"), "test");
  res = await cache.match("http://localhost");
  t.is((await res?.formData())?.get("file"), "test");

  const compat = new Compatibility(undefined, [
    "formdata_parser_supports_files",
  ]);
  plugin = new CachePlugin({ ...ctx, compat });
  caches = plugin.setup(factory).globals?.caches;
  cache = await caches.open("test");

  res = await caches.default.match("http://localhost");
  t.true((await res?.formData())?.get("file") instanceof File);
  res = await cache.match("http://localhost");
  t.true((await res?.formData())?.get("file") instanceof File);
});
test("CachePlugin: setup: operations throw outside request handler unless globalAsyncIO set", async (t) => {
  const factory = new MemoryStorageFactory();
  let plugin = new CachePlugin({ ...ctx, globalAsyncIO: false });
  let caches: CacheStorage = plugin.setup(factory).globals?.caches;
  await t.throwsAsync(caches.default.match("http://localhost"), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });

  plugin = new CachePlugin({ ...ctx, globalAsyncIO: true });
  caches = plugin.setup(factory).globals?.caches;
  await caches.default.match("http://localhost");
});
