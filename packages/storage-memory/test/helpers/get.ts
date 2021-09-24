import assert from "assert";
import { Macro } from "ava";
import { utf8Decode, utf8Encode } from "test:@miniflare/shared";
import { MIXED_SEED, TestOperatorFactory, assertExpiring } from "./shared";

export const getExistingMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const value = await storage.get("key1");
  t.is(utf8Decode(value?.value), "value1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
getExistingMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets existing key`;

export const getExistingWithMetadataMacro: Macro<[TestOperatorFactory]> =
  async (t, { usesActualTime, operatorFactory }) => {
    const storage = await operatorFactory(t, MIXED_SEED);
    const value = await storage.get("key2");
    t.is(utf8Decode(value?.value), "value2");
    assertExpiring(t, usesActualTime, value?.expiration);
    t.deepEqual(value?.metadata, { testing: true });
  };
getExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets existing key with metadata`;

export const getNonExistentMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const value = await storage.get("key5");
  t.is(value, undefined);
};
getNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: get: returns undefined for non-existent key`;

export const getExpiredMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const value = await storage.get("key3");
  t.is(value, undefined);
};
getExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: get: respects expiration`;

export const getSkipsMetadataMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesSkipMetadata, operatorFactory }
) => {
  if (!usesSkipMetadata) {
    t.pass("skipped as doesn't respect skipMetadata");
    return;
  }
  const storage = await operatorFactory(t, MIXED_SEED);
  const value = await storage.get("key2", true);
  t.is(utf8Decode(value?.value), "value2");
  // @ts-expect-error we're checking this is undefined
  t.is(value?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(value?.metadata, undefined);
};
getSkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: get: skips metadata`;

export const getCopyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const result1 = await storage.get("key1");
  t.not(result1, undefined);
  assert(result1);
  // Mutate data and check updates not stored
  result1.value = utf8Encode("new value");
  result1.expiration = 1000;
  result1.metadata = { new: "value" };
  const result2 = await storage.get("key1");
  t.deepEqual(result2, {
    value: utf8Encode("value1"),
    expiration: undefined,
    metadata: undefined,
  });
};
getCopyMacro.title = (providedTitle, { name }) =>
  `${name}: get: returns copy of data`;

export const getManyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesActualTime, operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const values = await storage.getMany(["key1", "key2", "key3", "key5"]);
  t.is(values.length, 4);

  t.is(utf8Decode(values[0]?.value), "value1");
  t.is(values[0]?.expiration, undefined);
  t.is(values[0]?.metadata, undefined);

  t.is(utf8Decode(values[1]?.value), "value2");
  assertExpiring(t, usesActualTime, values[1]?.expiration);
  t.deepEqual(values[1]?.metadata, { testing: true });

  t.is(values[2], undefined); // expired
  t.is(values[3], undefined); // nonexistent
};
getManyMacro.title = (providedTitle, { name }) =>
  `${name}: get: gets many keys`;

export const getManyEmptyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  t.deepEqual(await storage.getMany([]), []);
};
getManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: getMany: returns nothing for empty keys`;

export const getManySkipsMetadataMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesSkipMetadata, operatorFactory }
) => {
  if (!usesSkipMetadata) {
    t.pass("skipped as doesn't respect skipMetadata");
    return;
  }
  const storage = await operatorFactory(t, MIXED_SEED);
  const values = await storage.getMany(["key2"], true);
  t.is(values.length, 1);
  t.is(utf8Decode(values[0]?.value), "value2");
  // @ts-expect-error we're checking this is undefined
  t.is(values[0]?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(values[0]?.metadata, undefined);
};
getManySkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: getMany: skips metadata`;
