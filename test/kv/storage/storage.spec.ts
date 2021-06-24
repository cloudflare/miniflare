import { promises as fs } from "fs";
import path from "path";
import test, { ExecutionContext, Macro } from "ava";
import {
  FileKVStorage,
  KVStorage,
  KVStoredValue,
  MemoryKVStorage,
} from "../../../src";
import { useTmp } from "../../helpers";

const collator = new Intl.Collator();

type TestStorageFactory = {
  name: string;
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
    map.set("dir/key3", { value: Buffer.from("value3", "utf8") });
    return new MemoryKVStorage(map);
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
    await fs.mkdir(path.join(tmp, "dir"));
    await fs.writeFile(path.join(tmp, "dir", "key3"), "value3", "utf8");
    return new FileKVStorage(tmp);
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

const hasMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  t.true(await storage.has("key1"));
  t.true(await storage.has("key2"));
  t.true(await storage.has("dir/key3"));
  t.false(await storage.has("key4"));
};
hasMacro.title = (providedTitle, { name }) =>
  `${name}: has: checks if keys exist`;
test(hasMacro, memoryStorageFactory);
test(hasMacro, fileStorageFactory);

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

const getExistingWithMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("key2");
  t.is(value?.value.toString("utf8"), "value2");
  t.is(value?.expiration, 1000);
  t.deepEqual(value?.metadata, { testing: true });
};
getExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets existing key with metadata`;
test(getExistingWithMetadataMacro, memoryStorageFactory);
test(getExistingWithMetadataMacro, fileStorageFactory);

const getNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const value = await storage.get("badkey");
  t.is(value, undefined);
};
getNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: get: returns undefined for non-existent key`;
test(getNonExistentMacro, memoryStorageFactory);
test(getNonExistentMacro, fileStorageFactory);

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

const putNewDirectoryMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  await storage.put("dir/newkey", { value: Buffer.from("newvalue", "utf8") });
  const value = await storage.get("dir/newkey");
  t.is(value?.value.toString("utf8"), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
putNewDirectoryMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key in new directory`;
test(putNewDirectoryMacro, memoryStorageFactory);
test(putNewDirectoryMacro, fileStorageFactory);

const putNewWithMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  await storage.put("newkey", {
    value: Buffer.from("newvalue", "utf8"),
    expiration: 1000,
    metadata: { testing: true },
  });
  const value = await storage.get("newkey");
  t.is(value?.value.toString("utf8"), "newvalue");
  t.is(value?.expiration, 1000);
  t.deepEqual(value?.metadata, { testing: true });
};
putNewWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key with metadata`;
test(putNewWithMetadataMacro, memoryStorageFactory);
test(putNewWithMetadataMacro, fileStorageFactory);

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

const deleteNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  t.false(await storage.delete("badkey"));
};
deleteNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: delete: returns false for non-existent key`;
test(deleteNonExistentMacro, memoryStorageFactory);
test(deleteNonExistentMacro, fileStorageFactory);

const listExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t);
  const keys = await storage.list();
  const sortedKeys = keys.sort((a, b) => collator.compare(a.name, b.name));
  t.deepEqual(sortedKeys, [
    { name: "dir/key3", expiration: undefined, metadata: undefined },
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "key2", expiration: 1000, metadata: { testing: true } },
  ]);
};
listExistingMacro.title = (providedTitle, { name }) =>
  `${name}: list: lists existing keys`;
test(listExistingMacro, memoryStorageFactory);
test(listExistingMacro, fileStorageFactory);

const listEmptyMacro: Macro<[TestStorageFactory]> = async (t, { factory }) => {
  const storage = await factory(t);
  t.deepEqual(await storage.list(), []);
};
listEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: list: returns empty array when no keys`;
test(listEmptyMacro, emptyMemoryStorageFactory);
test(listEmptyMacro, emptyFileStorageFactory);
