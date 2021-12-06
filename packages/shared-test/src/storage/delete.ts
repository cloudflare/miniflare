import { utf8Encode } from "@miniflare/shared-test";
import { Macro } from "ava";
import { MIXED_SEED, TestStorageFactory } from "./shared";

export const deleteExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  t.true(await storage.delete("key1"));
  t.is(await storage.get("key1"), undefined);
};
deleteExistingMacro.title = (providedTitle, { name }) =>
  `${name}: delete: deletes existing key`;

export const deleteNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  t.false(await storage.delete("key5"));
};
deleteNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: delete: returns false for non-existent key`;

export const deleteExpiredMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  t.false(await storage.delete("key3"));
};
deleteExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: delete: respects expiration`;

export const deleteInKeyNamespaceMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {});
  await storage.put("key", { value: utf8Encode("value") });
  t.false(await storage.delete("key/thing"));
};
deleteInKeyNamespaceMacro.title = (providedTitle, { name }) =>
  `${name}: delete: returns false for non-existent key in namespace that is also a key`;

export const deleteManyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
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

export const deleteManyEmptyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  t.is(await storage.deleteMany([]), 0);
};
deleteManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: deleteMany: returns nothing for empty keys`;
