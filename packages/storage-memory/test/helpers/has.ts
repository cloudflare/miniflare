import { Macro } from "ava";
import { MIXED_SEED, TestOperatorFactory } from "./shared";

export const hasMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  t.true(await storage.has("key1"));
  t.true(await storage.has("key2"));
  t.true(await storage.has("dir/key4"));
  t.false(await storage.has("key4"));
};
hasMacro.title = (providedTitle, { name }) =>
  `${name}: has: checks if keys exist`;

export const hasExpiredMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  t.false(await storage.has("key3"));
};
hasExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: has: respects expiration`;

export const hasManyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  // key3 expired, key5 nonexistent
  t.is(await storage.hasMany(["key1", "key2", "key3", "dir/key4", "key5"]), 3);
};
hasManyMacro.title = (providedTitle, { name }) =>
  `${name}: hasMany: checks if many keys exist`;

export const hasManyEmptyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  t.is(await storage.hasMany([]), 0);
};
hasManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: hasMany: returns nothing for empty keys`;
