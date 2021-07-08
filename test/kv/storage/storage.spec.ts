import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import test, { ExecutionContext, Macro } from "ava";
import Redis from "ioredis";
import {
  FileKVStorage,
  KVStorage,
  KVStoredKeyOnly,
  KVStoredValue,
  MemoryKVStorage,
} from "../../../src";
import { KVClock, millisToSeconds } from "../../../src/kv/helpers";
import { RedisKVStorage } from "../../../src/kv/storage/redis";
import { useTmp, within } from "../../helpers";

// Only test Redis if a server URL has been set
const redisUrl = process.env.TEST_REDIS_URL;
// Redis tests need to be run serially, so we can flush and have a fresh
// database each time (WARNING: tests will flush the selected DB)
const redisTest = redisUrl ? test.serial : test.skip;
const redis = redisUrl ? new Redis(redisUrl) : undefined;

const testClock: KVClock = () => 750000; // 750s

// All fixed expirations should be 1000s, and all others should be within 60s of
// now + 1hr
const now = millisToSeconds(Date.now());
const actualExpiration = now + 3600;

function assertExpiration(
  t: ExecutionContext,
  actualTime?: boolean,
  actual?: number
): number | undefined {
  if (actualTime) {
    within(t, 60, actual, actualExpiration);
  } else {
    t.is(actual, 1000);
  }
  return actual;
}

const collator = new Intl.Collator();
function sortKeys<T extends KVStoredKeyOnly[]>(keys: T): T {
  return keys.sort((a, b) => collator.compare(a.name, b.name));
}

type TestStorageFactory = {
  name: string;
  actualTime?: boolean;
  factory: (t: ExecutionContext) => Promise<KVStorage>;
};

// Factories returning stores seeded with different types of keys
const memoryStorageFactory: TestStorageFactory = {
  name: "MemoryKVStorage",
  async factory() {
    const map = new Map<string, KVStoredValue>();
    map.set("key1", { value: Buffer.from("value1", "utf8") });
    map.set("key2", {
      value: Buffer.from("value2", "utf8"),
      expiration: 1000,
      metadata: { testing: true },
    });
    map.set("key3", {
      value: Buffer.from("expired", "utf8"),
      expiration: 500,
    });
    map.set("dir/key4", { value: Buffer.from("value3", "utf8") });
    return new MemoryKVStorage(map, testClock);
  },
};
const fileStorageFactory: TestStorageFactory = {
  name: "FileKVStorage",
  async factory(t) {
    const tmp = await useTmp(t);
    await fs.writeFile(path.join(tmp, "key1"), "value1", "utf8");
    await fs.writeFile(path.join(tmp, "key2"), "value2", "utf8");
    await fs.writeFile(
      path.join(tmp, "key2.meta.json"),
      JSON.stringify({ expiration: 1000, metadata: { testing: true } }),
      "utf8"
    );
    await fs.writeFile(path.join(tmp, "key3"), "expired", "utf8");
    await fs.writeFile(
      path.join(tmp, "key3.meta.json"),
      JSON.stringify({ expiration: 500 }),
      "utf8"
    );
    await fs.writeFile(path.join(tmp, "dir_key4"), "value3", "utf8");
    await fs.writeFile(
      path.join(tmp, "dir_key4.meta.json"),
      JSON.stringify({ key: "dir/key4" }),
      "utf8"
    );
    return new FileKVStorage(tmp, true, testClock);
  },
};
const unsanitisedFileStorageFactory: TestStorageFactory = {
  name: "FileKVStorage (Unsanitised)",
  async factory(t) {
    const tmp = await useTmp(t);
    await fs.writeFile(path.join(tmp, "key1"), "value1", "utf8");
    await fs.writeFile(path.join(tmp, "key2"), "value2", "utf8");
    await fs.writeFile(
      path.join(tmp, "key2.meta.json"),
      JSON.stringify({ expiration: 1000, metadata: { testing: true } }),
      "utf8"
    );
    await fs.writeFile(path.join(tmp, "key3"), "expired", "utf8");
    await fs.writeFile(
      path.join(tmp, "key3.meta.json"),
      JSON.stringify({ expiration: 500 }),
      "utf8"
    );
    await fs.mkdir(path.join(tmp, "dir"));
    await fs.writeFile(path.join(tmp, "dir", "key4"), "value3", "utf8");
    return new FileKVStorage(tmp, false, testClock);
  },
};
const redisStorageFactory: TestStorageFactory = {
  name: "RedisKVStorage",
  actualTime: true,
  async factory() {
    const ns = "NAMESPACE";
    assert(redis);
    await redis.flushdb();
    await redis.set(`${ns}:value:key1`, "value1");
    await redis.set(`${ns}:value:key2`, "value2", "EX", 3600); // 1 hour
    await redis.set(`${ns}:meta:key2`, JSON.stringify({ testing: true }));
    await redis.set(`${ns}:value:key3`, "expired");
    await redis.expire(`${ns}:value:key3`, 0);
    await redis.set(`${ns}:value:dir/key4`, "value3");
    return new RedisKVStorage(ns, redis);
  },
};

// Factories returning stores with no keys
const emptyMemoryStorageFactory: TestStorageFactory = {
  name: "MemoryKVStorage",
  factory: async () => new MemoryKVStorage(),
};
const emptyFileStorageFactory: TestStorageFactory = {
  name: "FileKVStorage",
  factory: async (t) => new FileKVStorage(await useTmp(t)),
};
const emptyRedisStorageFactory: TestStorageFactory = {
  name: "RedisKVStorage",
  actualTime: true,
  async factory() {
    const ns = "NAMESPACE";
    assert(redis);
    await redis.flushdb();
    return new RedisKVStorage(ns, redis);
  },
};

const hasMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  t.true(await storage.has("key1"));
  t.true(await storage.has("key2"));
  t.true(await storage.has("dir/key4"));
  t.false(await storage.has("key4"));
};
hasMacro.title = (providedTitle, { name }) =>
  `${name}: has: checks if keys exist`;
test(hasMacro, memoryStorageFactory);
test(hasMacro, fileStorageFactory);
test(hasMacro, unsanitisedFileStorageFactory);
redisTest(hasMacro, redisStorageFactory);

const hasExpiredMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  t.false(await storage.has("key3"));
};
hasExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: has: respects expiration`;
test(hasExpiredMacro, memoryStorageFactory);
test(hasExpiredMacro, fileStorageFactory);
redisTest(hasExpiredMacro, redisStorageFactory);

const hasManyMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  // key3 expired, key5 nonexistent
  t.is(await storage.hasMany(["key1", "key2", "key3", "dir/key4", "key5"]), 3);
};
hasManyMacro.title = (providedTitle, { name }) =>
  `${name}: hasMany: checks if many keys exist`;
test(hasManyMacro, memoryStorageFactory);
test(hasManyMacro, fileStorageFactory);
test(hasManyMacro, unsanitisedFileStorageFactory);
redisTest(hasManyMacro, redisStorageFactory);

const hasManyEmptyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.is(await storage.hasMany([]), 0);
};
hasManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: hasMany: returns nothing for empty keys`;
test(hasManyEmptyMacro, memoryStorageFactory);
test(hasManyEmptyMacro, fileStorageFactory);
redisTest(hasManyEmptyMacro, redisStorageFactory);

const getExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("key1");
  t.is(value?.value.toString("utf8"), "value1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
getExistingMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets existing key`;
test(getExistingMacro, memoryStorageFactory);
test(getExistingMacro, fileStorageFactory);
redisTest(getExistingMacro, redisStorageFactory);

const getExistingWithMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("key2");
  t.is(value?.value.toString("utf8"), "value2");
  assertExpiration(t, actualTime, value?.expiration);
  t.deepEqual(value?.metadata, { testing: true });
};
getExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets existing key with metadata`;
test(getExistingWithMetadataMacro, memoryStorageFactory);
test(getExistingWithMetadataMacro, fileStorageFactory);
redisTest(getExistingWithMetadataMacro, redisStorageFactory);

const getNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("key5");
  t.is(value, undefined);
};
getNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: get: returns undefined for non-existent key`;
test(getNonExistentMacro, memoryStorageFactory);
test(getNonExistentMacro, fileStorageFactory);
redisTest(getNonExistentMacro, redisStorageFactory);

const getExpiredMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  const value = await storage.get("key3");
  t.is(value, undefined);
};
getExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: get: respects expiration`;
test(getExpiredMacro, memoryStorageFactory);
test(getExpiredMacro, fileStorageFactory);
redisTest(getExpiredMacro, redisStorageFactory);

const getSkipsMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("key2", true);
  t.is(value?.value.toString("utf8"), "value2");
  // @ts-expect-error we're checking this is undefined
  t.is(value?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(value?.metadata, undefined);
};
getSkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: get: skips metadata`;
redisTest(getSkipsMetadataMacro, redisStorageFactory);

const getManyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  const values = await storage.getMany(["key1", "key2", "key3", "key5"]);
  t.is(values.length, 4);

  t.is(values[0]?.value.toString("utf8"), "value1");
  t.is(values[0]?.expiration, undefined);
  t.is(values[0]?.metadata, undefined);

  t.is(values[1]?.value.toString("utf8"), "value2");
  assertExpiration(t, actualTime, values[1]?.expiration);
  t.deepEqual(values[1]?.metadata, { testing: true });

  t.is(values[2], undefined); // expired
  t.is(values[3], undefined); // nonexistent
};
getManyMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets many keys`;
test(getManyMacro, memoryStorageFactory);
test(getManyMacro, fileStorageFactory);
redisTest(getManyMacro, redisStorageFactory);

const getManyEmptyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.deepEqual(await storage.getMany([]), []);
};
getManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: getMany: returns nothing for empty keys`;
test(getManyEmptyMacro, memoryStorageFactory);
test(getManyEmptyMacro, fileStorageFactory);
redisTest(getManyEmptyMacro, redisStorageFactory);

const getManySkipsMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const values = await storage.getMany(["key2"], true);
  t.is(values.length, 1);
  t.is(values[0]?.value.toString("utf8"), "value2");
  // @ts-expect-error we're checking this is undefined
  t.is(values[0]?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(values[0]?.metadata, undefined);
};
getManySkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: getMany: skips metadata`;
redisTest(getManySkipsMetadataMacro, redisStorageFactory);

const putNewMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  await storage.put("newkey", { value: Buffer.from("newvalue", "utf8") });
  const value = await storage.get("newkey");
  t.is(value?.value.toString("utf8"), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
putNewMacro.title = (providedTitle, { name }) => `${name}: put: puts new key`;
test(putNewMacro, memoryStorageFactory);
test(putNewMacro, fileStorageFactory);
redisTest(putNewMacro, redisStorageFactory);

const putNewDirectoryMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  await storage.put("dir/newkey", { value: Buffer.from("newvalue", "utf8") });
  const value = await storage.get("dir/newkey");
  t.is(value?.value.toString("utf8"), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  // Check real key was stored if path sanitised
  const keys = await storage.list();
  const sortedKeys = sortKeys(keys);

  const key2Expiration = assertExpiration(t, actualTime, keys[3].expiration);
  t.deepEqual(sortedKeys, [
    { name: "dir/key4", expiration: undefined, metadata: undefined },
    { name: "dir/newkey", expiration: undefined, metadata: undefined },
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "key2", expiration: key2Expiration, metadata: { testing: true } },
  ]);
};
putNewDirectoryMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key in new directory`;
test(putNewDirectoryMacro, memoryStorageFactory);
test(putNewDirectoryMacro, fileStorageFactory);
test(putNewDirectoryMacro, unsanitisedFileStorageFactory);
redisTest(putNewDirectoryMacro, redisStorageFactory);

const putNewWithMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  await storage.put("newkey", {
    value: Buffer.from("newvalue", "utf8"),
    expiration: actualTime ? actualExpiration : 1000,
    metadata: { testing: true },
  });
  const value = await storage.get("newkey");
  t.is(value?.value.toString("utf8"), "newvalue");
  assertExpiration(t, actualTime, value?.expiration);
  t.deepEqual(value?.metadata, { testing: true });
};
putNewWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key with metadata`;
test(putNewWithMetadataMacro, memoryStorageFactory);
test(putNewWithMetadataMacro, fileStorageFactory);
redisTest(putNewWithMetadataMacro, redisStorageFactory);

const putOverrideMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  await storage.put("key1", { value: Buffer.from("newvalue", "utf8") });
  const value = await storage.get("key1");
  t.is(value?.value.toString("utf8"), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
putOverrideMacro.title = (providedTitle, { name }) =>
  `${name}: put: overrides existing key`;
test(putOverrideMacro, memoryStorageFactory);
test(putOverrideMacro, fileStorageFactory);
redisTest(putOverrideMacro, redisStorageFactory);

const putManyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  await storage.putMany([
    ["key1", { value: Buffer.from("value1", "utf8") }],
    [
      "key2",
      {
        value: Buffer.from("value2", "utf8"),
        expiration: actualTime ? actualExpiration : 1000,
        metadata: { testing: true },
      },
    ],
  ]);
  const values = await storage.getMany(["key1", "key2"]);
  t.is(values.length, 2);

  t.is(values[0]?.value.toString("utf8"), "value1");
  t.is(values[0]?.expiration, undefined);
  t.is(values[0]?.metadata, undefined);

  t.is(values[1]?.value.toString("utf8"), "value2");
  assertExpiration(t, actualTime, values[1]?.expiration);
  t.deepEqual(values[1]?.metadata, { testing: true });
};
putManyMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts many keys`;
test(putManyMacro, memoryStorageFactory);
test(putManyMacro, fileStorageFactory);
redisTest(putManyMacro, redisStorageFactory);

const putManyEmptyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  await storage.putMany([]);
  t.pass();
};
putManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: putMany: succeeds with empty data`;
test(putManyEmptyMacro, memoryStorageFactory);
test(putManyEmptyMacro, fileStorageFactory);
redisTest(putManyEmptyMacro, redisStorageFactory);

const deleteExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.true(await storage.delete("key1"));
  t.is(await storage.get("key1"), undefined);
};
deleteExistingMacro.title = (providedTitle, { name }) =>
  `${name}: delete: deletes existing key`;
test(deleteExistingMacro, memoryStorageFactory);
test(deleteExistingMacro, fileStorageFactory);
redisTest(deleteExistingMacro, redisStorageFactory);

const deleteNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.false(await storage.delete("key5"));
};
deleteNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: delete: returns false for non-existent key`;
test(deleteNonExistentMacro, memoryStorageFactory);
test(deleteNonExistentMacro, fileStorageFactory);
redisTest(deleteNonExistentMacro, redisStorageFactory);

const deleteExpiredMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.false(await storage.delete("key3"));
};
deleteExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: delete: respects expiration`;
test(deleteExpiredMacro, memoryStorageFactory);
test(deleteExpiredMacro, fileStorageFactory);
redisTest(deleteExpiredMacro, redisStorageFactory);

const deleteManyMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  // key3 expired, key5 nonexistent
  t.is(await storage.deleteMany(["key1", "key2", "key3", "key5"]), 2);
  t.deepEqual(await storage.getMany(["key1", "key2", "key3", "key5"]), [
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
};
deleteManyMacro.title = (providedTitle, { name }) =>
  `${name}: delete: deletes many keys`;
test(deleteManyMacro, memoryStorageFactory);
test(deleteManyMacro, fileStorageFactory);
redisTest(deleteManyMacro, redisStorageFactory);

const deleteManyEmptyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.is(await storage.deleteMany([]), 0);
};
deleteManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: deleteMany: returns nothing for empty keys`;
test(deleteManyEmptyMacro, memoryStorageFactory);
test(deleteManyEmptyMacro, fileStorageFactory);
redisTest(deleteManyEmptyMacro, redisStorageFactory);

const listExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  const keys = await storage.list();
  const sortedKeys = sortKeys(keys);
  // Note expired key key3 shouldn't be returned
  const key2Expiration = assertExpiration(t, actualTime, keys[2].expiration);
  t.deepEqual(sortedKeys, [
    { name: "dir/key4", expiration: undefined, metadata: undefined },
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "key2", expiration: key2Expiration, metadata: { testing: true } },
  ]);
};
listExistingMacro.title = (providedTitle, { name }) =>
  `${name}: list: lists existing keys`;
test(listExistingMacro, memoryStorageFactory);
test(listExistingMacro, fileStorageFactory);
test(listExistingMacro, unsanitisedFileStorageFactory);
redisTest(listExistingMacro, redisStorageFactory);

const listEmptyMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  const keys = await storage.list();
  t.deepEqual(keys, []);
};
listEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: list: returns empty array when no keys`;
test(listEmptyMacro, emptyMemoryStorageFactory);
test(listEmptyMacro, emptyFileStorageFactory);
redisTest(listEmptyMacro, emptyRedisStorageFactory);

const listPrefixMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  const keys = await storage.list({ prefix: "key" });
  const sortedKeys = sortKeys(keys);
  // Note expired key key3 shouldn't be returned
  const key2Expiration = assertExpiration(t, actualTime, keys[1].expiration);
  t.deepEqual(sortedKeys, [
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "key2", expiration: key2Expiration, metadata: { testing: true } },
  ]);
};
listPrefixMacro.title = (providedTitle, { name }) =>
  `${name}: list: respects prefix filter`;
test(listPrefixMacro, memoryStorageFactory);
test(listPrefixMacro, fileStorageFactory);
test(listPrefixMacro, unsanitisedFileStorageFactory);
redisTest(listPrefixMacro, redisStorageFactory);

const listKeysFilterMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  t.plan(2);
  const storage = await factory(t);
  const keys = await storage.list({
    prefix: "key",
    keysFilter(keys) {
      // Check keys not matching the prefix or expired filtered out already
      t.true(
        keys.every((key) => key.name.startsWith("key") && key.name !== "key3")
      );
      return keys.filter((key) => key.name === "key1");
    },
  });
  t.deepEqual(keys, [
    { name: "key1", expiration: undefined, metadata: undefined },
  ]);
};
listKeysFilterMacro.title = (providedTitle, { name }) =>
  `${name}: list: respects keys filter`;
test(listKeysFilterMacro, memoryStorageFactory);
test(listKeysFilterMacro, fileStorageFactory);
test(listKeysFilterMacro, unsanitisedFileStorageFactory);
redisTest(listKeysFilterMacro, redisStorageFactory);

const listKeysFilterOrderMacro: Macro<[TestStorageFactory]> = async (
  t,
  { actualTime, factory }
) => {
  const storage = await factory(t);
  const keys = await storage.list({
    keysFilter: (keys) => keys.sort((a, b) => collator.compare(b.name, a.name)),
  });
  // Check order preserved from filter output
  const key2Expiration = assertExpiration(t, actualTime, keys[0].expiration);
  t.deepEqual(keys, [
    { name: "key2", expiration: key2Expiration, metadata: { testing: true } },
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "dir/key4", expiration: undefined, metadata: undefined },
  ]);
};
listKeysFilterOrderMacro.title = (providedTitle, { name }) =>
  `${name}: list: preserves keys filter's returned order`;
test(listKeysFilterOrderMacro, memoryStorageFactory);
test(listKeysFilterOrderMacro, fileStorageFactory);
test(listKeysFilterOrderMacro, unsanitisedFileStorageFactory);
redisTest(listKeysFilterOrderMacro, redisStorageFactory);

const listSkipsMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const keys = await storage.list({
    skipMetadata: true,
    prefix: "key",
    keysFilter: (keys) => keys.filter((key) => key.name === "key2"),
  });
  t.is(keys.length, 1);
  t.is(keys[0]?.name, "key2");
  t.is(keys[0]?.expiration, undefined);
  t.is(keys[0]?.metadata, undefined);
};
listSkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: list: skips metadata`;
redisTest(listSkipsMetadataMacro, redisStorageFactory);
