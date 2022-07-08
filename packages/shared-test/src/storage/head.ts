import assert from "assert";
import { Macro } from "ava";
import { utf8Encode } from "../data";
import { MIXED_SEED, TestStorageFactory, assertExpiring } from "./shared";

export const headExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.head("key1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
headExistingMacro.title = (providedTitle, { name }) =>
  `${name}: head: gets existing key`;

export const headExistingWithMetadataMacro: Macro<[TestStorageFactory]> =
  async (t, { usesActualTime, factory }) => {
    const storage = await factory(t, MIXED_SEED);
    const value = await storage.head("key2");
    assertExpiring(t, usesActualTime, value?.expiration);
    t.deepEqual(value?.metadata, { testing: true });
  };
headExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: head: gets existing key with metadata`;

export const headNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.head("key5");
  t.is(value, undefined);
};
headNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: head: returns undefined for non-existent key`;

export const headExpiredMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.head("key3");
  t.is(value, undefined);
};
headExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: head: respects expiration`;

export const headInKeyNamespaceMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {});
  await storage.put("key", { value: utf8Encode("value") });
  const value = await storage.head("key/thing");
  t.is(value, undefined);
};
headInKeyNamespaceMacro.title = (providedTitle, { name }) =>
  `${name}: head: returns undefined for non-existent key in namespace that is also a key`;

export const headCopyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const result1 = await storage.get("key1");
  t.not(result1, undefined);
  assert(result1);
  // Mutate data and check updates not stored
  result1.value = utf8Encode("new value");
  result1.expiration = 1000;
  result1.metadata = { new: "value" };
  const result2 = await storage.head("key1");
  t.deepEqual(result2, {
    expiration: undefined,
    metadata: undefined,
  });
};
headCopyMacro.title = (providedTitle, { name }) =>
  `${name}: head: returns copy of data`;
