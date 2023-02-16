import assert from "assert";
import path from "path";
import { KVNamespace, KVPlugin } from "@miniflare/kv";
import { QueueBroker } from "@miniflare/queues";
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

test("KVPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(KVPlugin, [
    "--kv",
    "NAMESPACE1",
    "--kv",
    "NAMESPACE2",
    "--kv-persist",
    "path",
  ]);
  t.deepEqual(options, {
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: "path",
  });
  options = parsePluginArgv(KVPlugin, [
    "-k",
    "NAMESPACE1",
    "-k",
    "NAMESPACE2",
    "--kv-persist",
  ]);
  t.deepEqual(options, {
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: true,
  });
});
test("KVPlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(KVPlugin, {
    kv_namespaces: [{ binding: "NAMESPACE1" }, { binding: "NAMESPACE2" }],
    miniflare: { kv_persist: "path" },
  });
  t.deepEqual(options, {
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: "path",
  });
});
test("KVPlugin: logs options", (t) => {
  const logs = logPluginOptions(KVPlugin, {
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: true,
  });
  t.deepEqual(logs, [
    "KV Namespaces: NAMESPACE1, NAMESPACE2",
    "KV Persistence: true",
  ]);
});
test("KVPlugin: getNamespace: creates namespace", async (t) => {
  const map = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({ ["test://map:NAMESPACE"]: map });

  const plugin = new KVPlugin(ctx, { kvPersist: "test://map" });
  const namespace = plugin.getNamespace(factory, "NAMESPACE");
  await namespace.put("key", "value");
  t.true(map.has("key"));
});
test("KVPlugin: getNamespace: resolves persist path relative to rootPath", async (t) => {
  const tmp = await useTmp(t);
  const map = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({
    [`${tmp}${path.sep}test:NAMESPACE`]: map,
  });

  const plugin = new KVPlugin({ ...ctx, rootPath: tmp }, { kvPersist: "test" });
  const namespace = plugin.getNamespace(factory, "NAMESPACE");
  await namespace.put("key", "value");
  t.true(map.has("key"));
});
test("KVPlugin: setup: includes namespaces in bindings", async (t) => {
  const map1 = new Map<string, StoredValueMeta>();
  const map2 = new Map<string, StoredValueMeta>();
  const factory = new MemoryStorageFactory({
    ["test://map:NAMESPACE1"]: map1,
    ["test://map:NAMESPACE2"]: map2,
  });

  const plugin = new KVPlugin(ctx, {
    kvPersist: "test://map",
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
  });
  const result = await plugin.setup(factory);
  t.true(result.bindings?.NAMESPACE1 instanceof KVNamespace);
  t.true(result.bindings?.NAMESPACE2 instanceof KVNamespace);
  assert(result.bindings?.NAMESPACE1 instanceof KVNamespace);
  assert(result.bindings?.NAMESPACE2 instanceof KVNamespace);
  await result.bindings?.NAMESPACE1.put("key1", "value1");
  await result.bindings?.NAMESPACE2.put("key2", "value2");
  t.true(map1.has("key1"));
  t.true(map2.has("key2"));
});
test("KVPlugin: setup: operations throw outside request handler unless globalAsyncIO set", async (t) => {
  const factory = new MemoryStorageFactory();
  let plugin = new KVPlugin(
    { ...ctx, globalAsyncIO: false },
    { kvNamespaces: ["NAMESPACE"] }
  );
  let ns: KVNamespace = (await plugin.setup(factory)).bindings?.NAMESPACE;
  await t.throwsAsync(ns.get("key"), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });

  plugin = new KVPlugin(
    { ...ctx, globalAsyncIO: true },
    { kvNamespaces: ["NAMESPACE"] }
  );
  ns = (await plugin.setup(factory)).bindings?.NAMESPACE;
  await ns.get("key");
});
