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
  // Get operators from each factory using the same namespace
  const operator1 = await factory1.operator("ns");
  const operator2 = await factory2.operator("ns");
  // Check storage returns same instance
  t.is(await factory1.storage("ns"), operator1);
  t.is(await factory2.storage("ns"), operator2);
  // Check operators have distinct storage
  await operator1.put("key", { value: utf8Encode("value1") });
  await operator2.put("key", { value: utf8Encode("value2") });
  t.is(utf8Decode((await operator1.get("key"))?.value), "value1");
  t.is(utf8Decode((await operator2.get("key"))?.value), "value2");
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
  const operator = await factory.operator("ns", true);
  t.is(await factory.storage("ns", true), operator);
  await operator.put("key", { value: utf8Encode("value") });
  t.is(utf8Decode(map.get("key")?.value), "value");
});
test("PluginStorageFactory: uses custom location/database", async (t) => {
  const map = new Map<string, StoredValueMeta<CachedMeta>>();
  const inner = new MemoryStorageFactory({
    ["custom:test:ns"]: map,
  });
  const factory = new PluginStorageFactory(inner, "TestPlugin");
  const operator = await factory.operator("ns", "custom:test");
  t.is(await factory.storage("ns", "custom:test"), operator);
  await operator.put("key", { value: utf8Encode("value") });
  t.is(utf8Decode(map.get("key")?.value), "value");
});
