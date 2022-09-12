import path from "path";
import { CachedMeta } from "@miniflare/cache";
import { PluginStorageFactory } from "@miniflare/core";
import { StoredValueMeta } from "@miniflare/shared";
import {
  MemoryStorageFactory,
  utf8Decode,
  utf8Encode,
} from "@miniflare/shared-test";
import test from "ava";

test("PluginStorageFactory: namespaces memory storage", async (t) => {
  const inner = new MemoryStorageFactory();
  const factory1 = new PluginStorageFactory(inner, "Test1Plugin");
  const factory2 = new PluginStorageFactory(inner, "Test2Plugin");
  // Get storages from each factory using the same namespace
  const storage1 = factory1.storage("ns");
  const storage2 = factory2.storage("ns");
  // Check storages have distinct storage
  await storage1.put("key", { value: utf8Encode("value1") });
  await storage2.put("key", { value: utf8Encode("value2") });
  t.is(utf8Decode((await storage1.get("key"))?.value), "value1");
  t.is(utf8Decode((await storage2.get("key"))?.value), "value2");
  // Check namespaced storages were created
  t.true(inner.storages.has("test1:ns"));
  t.true(inner.storages.has("test2:ns"));
});
test("PluginStorageFactory: uses default file storage location", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const defaultPersistRoot = "default";
  const inner = new MemoryStorageFactory({
    [`${path.join(defaultPersistRoot, "test")}:ns`]: map,
  });
  const factory = new PluginStorageFactory(
    inner,
    "TestPlugin",
    defaultPersistRoot
  );
  const storage = factory.storage("ns", true);
  await storage.put("key", { value: utf8Encode("value") });
  t.is(utf8Decode(map.get("key")?.value), "value");
});
test("PluginStorageFactory: uses custom location/database", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const inner = new MemoryStorageFactory({
    ["custom:test:ns"]: map,
  });
  const factory = new PluginStorageFactory(inner, "TestPlugin");
  const storage = factory.storage("ns", "custom:test");
  await storage.put("key", { value: utf8Encode("value") });
  t.is(utf8Decode(map.get("key")?.value), "value");
});
