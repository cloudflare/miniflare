import assert from "assert";
import { Macro } from "ava";
import { utf8Decode, utf8Encode } from "../data";
import { MIXED_SEED, TestStorageFactory, assertExpiring } from "./shared";

export const getExistingMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1");
  t.is(utf8Decode(value?.value), "value1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 0,
    length: 6,
  });
};
getExistingMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: gets existing key`;

export const getExistingWithMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { usesActualTime, factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key2");
  t.is(utf8Decode(value?.value), "value2");
  assertExpiring(t, usesActualTime, value?.expiration);
  t.deepEqual(value?.metadata, { testing: true });
  t.deepEqual(value?.range, {
    offset: 0,
    length: 6,
  });
};
getExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: gets existing key with metadata`;

export const getNonExistentMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key5");
  t.is(value, undefined);
};
getNonExistentMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: returns undefined for non-existent key`;

export const getExpiredMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key3");
  t.is(value, undefined);
};
getExpiredMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: respects expiration`;

export const getInKeyNamespaceMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {});
  await storage.put("key", { value: utf8Encode("value") });
  const value = await storage.get("key/thing");
  t.is(value, undefined);
};
getInKeyNamespaceMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: returns undefined for non-existent key in namespace that is also a key`;

export const getSkipsMetadataMacro: Macro<[TestStorageFactory]> = async (
  t,
  { usesSkipMetadata, factory }
) => {
  if (!usesSkipMetadata) {
    t.pass("skipped as doesn't respect skipMetadata");
    return;
  }
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange(
    "key2",
    undefined,
    undefined,
    undefined,
    true
  );
  t.is(utf8Decode(value?.value), "value2");
  // @ts-expect-error we're checking this is undefined
  t.is(value?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 0,
    length: 6,
  });
};
getSkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: skips metadata`;

export const getCopyMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const result1 = await storage.getRange("key1");
  t.not(result1, undefined);
  assert(result1);
  // Mutate data and check updates not stored
  result1.value = utf8Encode("new value");
  result1.expiration = 1000;
  result1.metadata = { new: "value" };
  const result2 = await storage.getRange("key1");
  t.deepEqual(result2, {
    value: utf8Encode("value1"),
    expiration: undefined,
    metadata: undefined,
    range: {
      offset: 0,
      length: 6,
    },
  });
};
getCopyMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: returns copy of data`;

export const getOffsetMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", 2);
  t.is(utf8Decode(value?.value), "lue1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 2,
    length: 4,
  });
};
getOffsetMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset: returns proper data`;

export const getLengthMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", undefined, 2);
  t.is(utf8Decode(value?.value), "va");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 0,
    length: 2,
  });
};
getLengthMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: length: automatically sets offset to 0, returns proper data`;

export const getOffsetLengthMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", 2, 2);
  t.is(utf8Decode(value?.value), "lu");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 2,
    length: 2,
  });
};
getOffsetLengthMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset & length: returns proper data`;

export const getSuffixMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", undefined, undefined, 2);
  t.is(utf8Decode(value?.value), "e1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 4,
    length: 2,
  });
};
getSuffixMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: suffix: returns proper data`;

export const getOffsetLengthSuffixMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", 2, 2, 2);
  t.is(utf8Decode(value?.value), "e1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 4,
    length: 2,
  });
};
getOffsetLengthSuffixMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset & length & suffix: prioritizes suffix`;

export const getLengthOutsideMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  const value = await storage.getRange("key1", 4, 4);
  t.is(utf8Decode(value?.value), "e1");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  t.deepEqual(value?.range, {
    offset: 4,
    length: 2,
  });
};
getLengthOutsideMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset & length: length goes beyond end of data`;

export const getOffsetOutsideMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  await t.throwsAsync(async () => storage.getRange("key1", -2, 4), {
    message: "Offset must be >= 0",
  });
};
getOffsetOutsideMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset & length: offset goes beneath start of data throws`;

export const getOffsetGreaterThanSizeMacro: Macro<[TestStorageFactory]> =
  async (t, { factory }) => {
    const storage = await factory(t, MIXED_SEED);
    await t.throwsAsync(async () => storage.getRange("key1", 12, 2), {
      message: "Offset must be < size",
    });
  };
getOffsetGreaterThanSizeMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: offset & length: offset goes past size of data throws`;

export const getLengthIsZeroMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  await t.throwsAsync(async () => storage.getRange("key1", 0, 0), {
    message: "Length must be > 0",
  });
};
getLengthIsZeroMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: length: equal to 0 throws`;

export const getLengthLessThanZeroMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  await t.throwsAsync(async () => storage.getRange("key1", 0, -2), {
    message: "Length must be > 0",
  });
};
getLengthLessThanZeroMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: length: less than 0 throws`;

export const getSuffixZeroMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  await t.throwsAsync(
    async () => storage.getRange("key1", undefined, undefined, 0),
    {
      message: "Suffix must be > 0",
    }
  );
};
getSuffixZeroMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: suffix: equal to 0 throws`;

export const getSuffixTooSmallMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, MIXED_SEED);
  await t.throwsAsync(
    async () => storage.getRange("key1", undefined, undefined, -2),
    {
      message: "Suffix must be > 0",
    }
  );
};
getSuffixTooSmallMacro.title = (providedTitle, { name }) =>
  `${name}: getRange: suffix: less than 0 throws`;
