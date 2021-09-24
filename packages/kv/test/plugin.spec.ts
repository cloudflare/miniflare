import assert from "assert";
import { CachedMeta } from "@miniflare/cache";
import { KVNamespace, KVPlugin } from "@miniflare/kv";
import { StoredValueMeta } from "@miniflare/shared";
import test from "ava";
import {
  MemoryStorageFactory,
  NoOpLog,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "test:@miniflare/shared";

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
  const log = new NoOpLog();
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({ ["map:NAMESPACE"]: map });

  const plugin = new KVPlugin(log, { kvPersist: "map" });
  const namespace = await plugin.getNamespace(factory, "NAMESPACE");
  await namespace.put("key", "value");
  t.true(map.has("key"));
});
test("KVPlugin: setup: includes namespaces in bindings", async (t) => {
  const log = new NoOpLog();
  const map1 = new Map<string, StoredValueMeta<CachedMeta>>();
  const map2 = new Map<string, StoredValueMeta<CachedMeta>>();
  const factory = new MemoryStorageFactory({
    ["map:NAMESPACE1"]: map1,
    ["map:NAMESPACE2"]: map2,
  });

  const plugin = new KVPlugin(log, {
    kvPersist: "map",
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
