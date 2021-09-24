import { StorageListOptions } from "@miniflare/shared";
import { Macro } from "ava";
import { utf8Encode } from "test:@miniflare/shared";
import {
  MIXED_SEED,
  SECTION_SEED,
  TestOperatorFactory,
  assertExpiring,
  keyNames,
} from "./shared";

const listMacro = function (
  description: string,
  expectedPages: string[][],
  options?: StorageListOptions
): Macro<[TestOperatorFactory]> {
  const macro: Macro<[TestOperatorFactory]> = async (
    t,
    { operatorFactory, usesListCursor }
  ) => {
    if (options?.cursor && !usesListCursor) {
      t.pass("skipped as doesn't support list cursor");
      return;
    }
    const storage = await operatorFactory(t, SECTION_SEED);
    let lastCursor = "";
    for (let i = 0; i < expectedPages.length; i++) {
      const { keys, cursor } = await storage.list({
        ...options,
        cursor: options?.cursor ?? lastCursor,
      });
      t.deepEqual(keyNames(keys), expectedPages[i]);
      if (i === expectedPages.length - 1 || !usesListCursor) {
        // Last Page
        t.is(cursor, "");
      } else {
        t.not(cursor, "");
      }
      if (!usesListCursor) break;
      lastCursor = cursor;
    }
  };
  macro.title = (providedTitle, { name }) => `${name}: list: ${description}`;
  return macro;
};

export const listAllMacro = listMacro("lists all keys in sorted order", [
  [
    "section1key1",
    "section1key2",
    "section2key1",
    "section2key2",
    "section3key1",
    "section3key2",
  ],
]);

export const listStartMacro = listMacro(
  "lists keys starting from start inclusive",
  [["section2key2", "section3key1", "section3key2"]],
  { start: "section2key2" }
);

export const listEndMacro = listMacro(
  " lists keys ending at end exclusive",
  [["section1key1", "section1key2"]],
  { end: "section2key1" }
);

export const listReverseMacro = listMacro(
  "lists keys in reverse order",
  [
    [
      "section3key2",
      "section3key1",
      "section2key2",
      "section2key1",
      "section1key2",
      "section1key1",
    ],
  ],
  { reverse: true }
);

export const listLimitMacro = listMacro(
  "paginates keys with limit",
  [
    ["section1key1", "section1key2", "section2key1"],
    ["section2key2", "section3key1", "section3key2"],
  ],
  { limit: 3 }
);

export const listLargeLimitMacro = listMacro(
  "lists all keys if limit greater than number of keys",
  [
    [
      "section1key1",
      "section1key2",
      "section2key1",
      "section2key2",
      "section3key1",
      "section3key2",
    ],
  ],
  { limit: 100 }
);

export const listPrefixMacro = listMacro(
  "lists keys matching prefix",
  [["section2key1", "section2key2"]],
  { prefix: "section2" }
);

export const listCombinationMacro = listMacro(
  "paginates keys with start, limit and prefix in reverse",
  [
    ["section3key2", "section3key1"],
    ["section2key2", "section2key1"],
  ],
  { start: "section2", prefix: "section", limit: 2, reverse: true }
);

export const listStartAfterAllMacro = listMacro(
  "returns empty list with start after all",
  [[]],
  { start: "section4" }
);

export const listEndBeforeAll = listMacro(
  "returns empty list with end before all",
  [[]],
  { end: "section0" }
);

export const listStartAfterEnd = listMacro(
  "returns empty list with start after end",
  [[]],
  { start: "section3", end: "section1" }
);

export const listInvalidCursor = listMacro(
  "returns empty list with an invalid cursor",
  [[]],
  { cursor: "not a cursor" }
);

export const listPaginateVariableMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory, usesListCursor }
) => {
  const storage = await operatorFactory(t, SECTION_SEED);

  // Get first page
  let page = await storage.list({ limit: 1 });
  t.deepEqual(keyNames(page.keys), ["section1key1"]);
  if (!usesListCursor) {
    t.is(page.cursor, "");
    return;
  }
  t.not(page.cursor, "");

  // Get second page with different limit
  page = await storage.list({ limit: 2, cursor: page.cursor });
  t.deepEqual(keyNames(page.keys), ["section1key2", "section2key1"]);
  t.not(page.cursor, "");

  // Get final page with different limit again
  page = await storage.list({ limit: 3, cursor: page.cursor });
  t.deepEqual(keyNames(page.keys), [
    "section2key2",
    "section3key1",
    "section3key2",
  ]);
  t.is(page.cursor, "");
};
listPaginateVariableMacro.title = (providedTitle, { name }) =>
  `${name}: list: paginates with variable limit`;

export const listInsertPaginateMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory, usesListCursor }
) => {
  const storage = await operatorFactory(t, {
    key1: { value: utf8Encode("value1") },
    key3: { value: utf8Encode("value3") },
    key5: { value: utf8Encode("value5") },
  });

  // Get first page
  let page = await storage.list({ limit: 2 });
  t.deepEqual(keyNames(page.keys), ["key1", "key3"]);
  if (!usesListCursor) {
    t.is(page.cursor, "");
    return;
  }
  t.not(page.cursor, "");

  // Insert key2 and key4
  await storage.putMany([
    ["key2", { value: utf8Encode("value2") }],
    ["key4", { value: utf8Encode("value4") }],
  ]);

  // Get second page, expecting to see key4 but not key2
  page = await storage.list({ limit: 2, cursor: page.cursor });
  t.deepEqual(keyNames(page.keys), ["key4", "key5"]);
  t.is(page.cursor, "");
};
listInsertPaginateMacro.title = (providedTitle, { name }) =>
  `${name}: list: returns keys inserted whilst paginating`;

export const listEmptyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, {});
  const { keys, cursor } = await storage.list();
  t.deepEqual(keys, []);
  t.is(cursor, "");
};
listEmptyMacro.title = (providedTitle, { name }) =>
  `${name}: list: returns empty list with no keys`;

export const listExistingWithMetadataMacro: Macro<[TestOperatorFactory]> =
  async (t, { usesActualTime, operatorFactory }) => {
    const storage = await operatorFactory(t, MIXED_SEED);
    const { keys, cursor } = await storage.list();
    // Note expired key key3 shouldn't be returned
    const key2Expiration = assertExpiring(
      t,
      usesActualTime,
      keys[2].expiration
    );
    t.deepEqual(keys, [
      { name: "dir/key4", expiration: undefined, metadata: undefined },
      { name: "key1", expiration: undefined, metadata: undefined },
      { name: "key2", expiration: key2Expiration, metadata: { testing: true } },
    ]);
    t.is(cursor, "");
  };
listExistingWithMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: list: lists existing keys with metadata`;

export const listSkipsMetadataMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { usesSkipMetadata, operatorFactory }
) => {
  if (!usesSkipMetadata) {
    t.pass("skipped as doesn't respect skipMetadata");
    return;
  }
  const storage = await operatorFactory(t, MIXED_SEED);
  const { keys, cursor } = await storage.list(
    { prefix: "key", start: "key2", limit: 1 },
    true
  );
  t.is(keys.length, 1);
  t.is(keys[0]?.name, "key2");
  // @ts-expect-error we're checking this is undefined
  t.is(keys[0]?.expiration, undefined);
  // @ts-expect-error we're checking this is undefined
  t.is(keys[0]?.metadata, undefined);
  t.is(cursor, "");
};
listSkipsMetadataMacro.title = (providedTitle, { name }) =>
  `${name}: list: skips metadata`;

export const listCopyMacro: Macro<[TestOperatorFactory]> = async (
  t,
  { operatorFactory }
) => {
  const storage = await operatorFactory(t, MIXED_SEED);
  const result1 = await storage.list({ start: "key1", limit: 1 });
  // Mutate data and check updates not stored
  result1.keys[0].name = "random";
  result1.keys[0].expiration = 1000;
  result1.keys[0].metadata = { new: "value" };
  const result2 = await storage.list({ start: "key1", limit: 1 });
  t.deepEqual(result2.keys, [
    { name: "key1", expiration: undefined, metadata: undefined },
  ]);
};
listCopyMacro.title = (providedTitle, { name }) =>
  `${name}: list: returns copy of data`;
