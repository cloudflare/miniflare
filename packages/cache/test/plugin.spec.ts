import assert from "assert";
import {
  CacheError,
  CachePlugin,
  CacheStorage,
  CachedMeta,
  NoOpCache,
} from "@miniflare/cache";
import { StoredValueMeta } from "@miniflare/shared";
import test from "ava";
import {
  MemoryStorageFactory,
  NoOpLog,
  getObjectProperties,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  utf8Decode,
} from "test:@miniflare/shared";
import { testResponse } from "./helpers";

test("CacheStorage: provides default cache", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, factory);
  await caches.default.put("http://localhost:8787/", testResponse());
  const cached = await caches.default.match("http://localhost:8787/");
  t.is(await cached?.text(), "value");
});
test("CacheStorage: namespaced caches are separate from default cache and each other", async (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, factory);
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
  const caches = new CacheStorage({}, factory);
  await t.throwsAsync(caches.open("default"), {
    instanceOf: CacheError,
    code: "ERR_RESERVED",
    message: '"default" is a reserved cache name',
  });
});
test("CacheStorage: persists cached data", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({ ["map:default"]: map });
  const caches = new CacheStorage({ cachePersist: "map" }, factory);
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
  const caches = new CacheStorage({ disableCache: true }, factory);
  await caches.default.put("http://localhost:8787/", testResponse());
  const cached = await caches.default.match("http://localhost:8787/");
  t.is(cached, undefined);
});
test("CacheStorage: hides implementation details", (t) => {
  const factory = new MemoryStorageFactory();
  const caches = new CacheStorage({}, factory);
  t.deepEqual(getObjectProperties(caches), ["default", "open"]);
});

test("CachePlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(CachePlugin, [
    "--cache-persist",
    "path",
    "--disable-cache",
  ]);
  t.deepEqual(options, { cachePersist: "path", disableCache: true });
  options = parsePluginArgv(CachePlugin, ["--cache-persist"]);
  t.deepEqual(options, { cachePersist: true });
});
test("CachePlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(CachePlugin, {
    miniflare: { cache_persist: "path", disable_cache: true },
  });
  t.deepEqual(options, { cachePersist: "path", disableCache: true });
});
test("CachePlugin: logs options", (t) => {
  const logs = logPluginOptions(CachePlugin, {
    cachePersist: "path",
    disableCache: true,
  });
  t.deepEqual(logs, ["Cache Persistence: path", "Cache Disabled: true"]);
});

test("CachePlugin: setup: includes CacheStorage in globals", async (t) => {
  const log = new NoOpLog();
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({ ["map:default"]: map });

  let plugin = new CachePlugin(log, { cachePersist: "map" });
  let result = plugin.setup(factory);
  let caches = result.globals?.caches;
  t.true(caches instanceof CacheStorage);
  assert(caches instanceof CacheStorage);
  await caches.default.put("http://localhost:8787/", testResponse());
  t.true(map.has("http://localhost:8787/"));

  plugin = new CachePlugin(log, { disableCache: true });
  result = plugin.setup(factory);
  caches = result.globals?.caches;
  t.true(caches instanceof CacheStorage);
  assert(caches instanceof CacheStorage);
  t.true(caches.default instanceof NoOpCache);
  t.true((await caches.open("test")) instanceof NoOpCache);
});
