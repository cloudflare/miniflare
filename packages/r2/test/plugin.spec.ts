import assert from "assert";
import path from "path";
import { QueueBroker } from "@miniflare/queues";
import { R2Bucket, R2Plugin } from "@miniflare/r2";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  StoredValueMeta,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";

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

test("R2Plugin: parses options from argv", (t) => {
  let options = parsePluginArgv(R2Plugin, [
    "--r2",
    "BUCKET1",
    "--r2",
    "BUCKET2",
    "--r2-persist",
    "path",
  ]);
  t.deepEqual(options, {
    r2Buckets: ["BUCKET1", "BUCKET2"],
    r2Persist: "path",
  });
  options = parsePluginArgv(R2Plugin, [
    "-r",
    "BUCKET1",
    "-r",
    "BUCKET2",
    "--r2-persist",
  ]);
  t.deepEqual(options, {
    r2Buckets: ["BUCKET1", "BUCKET2"],
    r2Persist: true,
  });
});
test("R2Plugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(R2Plugin, {
    r2_buckets: [{ binding: "BUCKET1" }, { binding: "BUCKET2" }],
    miniflare: { r2_persist: "path" },
  });
  t.deepEqual(options, {
    r2Buckets: ["BUCKET1", "BUCKET2"],
    r2Persist: "path",
  });
});
test("R2Plugin: logs options", (t) => {
  const logs = logPluginOptions(R2Plugin, {
    r2Buckets: ["BUCKET1", "BUCKET2"],
    r2Persist: true,
  });
  t.deepEqual(logs, ["R2 Buckets: BUCKET1, BUCKET2", "R2 Persistence: true"]);
});
test("R2Plugin: getBucket: creates bucket", async (t) => {
  const map = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({ ["test://map:BUCKET"]: map });

  const plugin = new R2Plugin(ctx, { r2Persist: "test://map" });
  const bucket = plugin.getBucket(factory, "BUCKET");
  await bucket.put("key", "value");
  t.true(map.has("key"));
});
test("R2Plugin: getBucket: resolves persist path relative to rootPath", async (t) => {
  const tmp = await useTmp(t);
  const map = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({
    [`${tmp}${path.sep}test:BUCKET`]: map,
  });

  const plugin = new R2Plugin({ ...ctx, rootPath: tmp }, { r2Persist: "test" });
  const bucket = plugin.getBucket(factory, "BUCKET");
  await bucket.put("key", "value");
  t.true(map.has("key"));
});
test("R2Plugin: setup: includes buckets in bindings", async (t) => {
  const map1 = new Map<string, StoredValueMeta>();
  const map2 = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({
    ["test://map:BUCKET1"]: map1,
    ["test://map:BUCKET2"]: map2,
  });

  const plugin = new R2Plugin(ctx, {
    r2Persist: "test://map",
    r2Buckets: ["BUCKET1", "BUCKET2"],
  });
  const result = await plugin.setup(factory);
  t.true(result.bindings?.BUCKET1 instanceof R2Bucket);
  t.true(result.bindings?.BUCKET2 instanceof R2Bucket);
  assert(result.bindings?.BUCKET1 instanceof R2Bucket);
  assert(result.bindings?.BUCKET2 instanceof R2Bucket);
  await result.bindings?.BUCKET1.put("key1", "value1");
  await result.bindings?.BUCKET2.put("key2", "value2");
  t.true(map1.has("key1"));
  t.true(map2.has("key2"));
});
test("R2Plugin: setup: operations throw outside request handler unless globalAsyncIO set", async (t) => {
  const factory = new MemoryStorageFactory();
  let plugin = new R2Plugin(
    { ...ctx, globalAsyncIO: false },
    { r2Buckets: ["BUCKET"] }
  );
  let r2: R2Bucket = (await plugin.setup(factory)).bindings?.BUCKET;
  await t.throwsAsync(r2.get("key"), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });

  plugin = new R2Plugin(
    { ...ctx, globalAsyncIO: true },
    { r2Buckets: ["BUCKET"] }
  );
  r2 = (await plugin.setup(factory)).bindings?.BUCKET;
  await r2.get("key");
});
test('R2Plugin: setup: implicitly includes customMetadata & httpMetadata if "r2_list_honor_include" flag not set', async (t) => {
  const factory = new MemoryStorageFactory();
  let compat = new Compatibility();
  let plugin = new R2Plugin({ ...ctx, compat }, { r2Buckets: ["BUCKET"] });
  let r2 = plugin.getBucket(factory, "BUCKET");

  await r2.put("key", "value", {
    customMetadata: { foo: "bar" },
    httpMetadata: { contentEncoding: "gzip" },
  });
  let { objects } = await r2.list({ include: [] });
  t.deepEqual(objects[0].customMetadata, { foo: "bar" });
  t.deepEqual(objects[0].httpMetadata, { contentEncoding: "gzip" });

  compat = new Compatibility(undefined, ["r2_list_honor_include"]);
  plugin = new R2Plugin({ ...ctx, compat }, { r2Buckets: ["BUCKET"] });
  r2 = plugin.getBucket(factory, "BUCKET");
  ({ objects } = await r2.list({ include: [] }));
  t.deepEqual(objects[0].customMetadata, {});
  t.deepEqual(objects[0].httpMetadata, {});
});
