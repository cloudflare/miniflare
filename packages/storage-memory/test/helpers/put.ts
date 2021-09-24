import { StoredValueMeta } from "@miniflare/shared";
import { Macro } from "ava";
import { utf8Decode, utf8Encode } from "test:@miniflare/shared";
import {
  MIXED_SEED,
  TIME_EXPIRING,
  TestOperatorFactory,
  assertExpiring,
  expectedActualExpiring,
} from "./shared";

export const putNewMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  await storage.put("newkey", { value: utf8Encode("newvalue") });
  const value = await storage.get("newkey");
  t.is(utf8Decode(value?.value), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
putNewMacro.title = (providedTitle, { name }) => `${name}: put: puts new key`;

export const putNewDirectoryMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  await storage.put("dir/newkey", { value: utf8Encode("newvalue") });
  const value = await storage.get("dir/newkey");
  t.is(utf8Decode(value?.value), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
  // Check real key was stored if path sanitised
  const { keys } = await storage.list();
  t.deepEqual(keys, [
    { name: "dir/newkey", expiration: undefined, metadata: undefined },
  ]);
};
putNewDirectoryMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key in new directory`;

export const putNewWithMetadataMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesActualTime, operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  await storage.put("newkey", {
    value: utf8Encode("newvalue"),
    expiration: usesActualTime ? expectedActualExpiring : 1000,
    metadata: { testing: true },
  });
  const value = await storage.get("newkey");
  t.is(utf8Decode(value?.value), "newvalue");
  assertExpiring(t, usesActualTime, value?.expiration);
  t.deepEqual(value?.metadata, { testing: true });
};
putNewWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts new key with metadata`;

export const putOverrideMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  await storage.put("key1", { value: utf8Encode("newvalue") });
  const value = await storage.get("key1");
  t.is(utf8Decode(value?.value), "newvalue");
  t.is(value?.expiration, undefined);
  t.is(value?.metadata, undefined);
};
putOverrideMacro.title = (providedTitle, { name }) =>
  `${name}: put: overrides existing key`;

export const putCopyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  const value: StoredValueMeta = {
    value: utf8Encode("value"),
    metadata: { testing: true },
  };
  await storage.put("key", value);
  // Mutate data and check updates not stored
  value.value = utf8Encode("new");
  value.expiration = 1000;
  value.metadata = { new: "value" };
  const result = await storage.get("key");
  t.deepEqual(result, {
    value: utf8Encode("value"),
    expiration: undefined,
    metadata: { testing: true },
  });
};
putCopyMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts copy of data`;

export const putManyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesActualTime, operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  await storage.putMany([
    ["key1", { value: utf8Encode("value1") }],
    [
      "key2",
      {
        value: utf8Encode("value2"),
        expiration: usesActualTime ? expectedActualExpiring : TIME_EXPIRING,
        metadata: { testing: true },
      },
    ],
  ]);
  const values = await storage.getMany(["key1", "key2"]);
  t.is(values.length, 2);

  t.is(utf8Decode(values[0]?.value), "value1");
  t.is(values[0]?.expiration, undefined);
  t.is(values[0]?.metadata, undefined);

  t.is(utf8Decode(values[1]?.value), "value2");
  assertExpiring(t, usesActualTime, values[1]?.expiration);
  t.deepEqual(values[1]?.metadata, { testing: true });
};
putManyMacro.title = (providedTitle, { name }) =>
  `${name}: put: puts many keys`;

export const putManyEmptyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  await storage.putMany([]);
  t.pass();
};
putManyEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: putMany: succeeds with empty data`;
