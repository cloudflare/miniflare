import { ReadableStream } from "stream/web";
import {
  KVGetValueType,
  KVListOptions,
  KVNamespace,
  KVPutOptions,
  KVPutValueType,
} from "@miniflare/kv";
import {
  StorageOperator,
  StoredKeyMeta,
  StoredValueMeta,
  base64Encode,
} from "@miniflare/shared";
import { MemoryStorageOperator } from "@miniflare/storage-memory";
import anyTest, { Macro, TestInterface } from "ava";
import { getObjectProperties, utf8Encode } from "test:@miniflare/shared";
import {
  TIME_EXPIRED,
  TIME_EXPIRING,
  TIME_NOW,
  testClock,
} from "test:@miniflare/storage-memory";

interface Context {
  storage: StorageOperator;
  ns: KVNamespace;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const storage = new MemoryStorageOperator(undefined, testClock);
  const ns = new KVNamespace(storage, testClock);
  t.context = { storage, ns };
});

const getMacro: Macro<
  [{ value: string; type?: KVGetValueType; expected: any }],
  Context
> = async (t, { value, type, expected }) => {
  const { storage, ns } = t.context;
  await storage.put("key", { value: utf8Encode(value) });
  // Test both ways of specifying the type
  t.deepEqual(await ns.get("key", type as any), expected);
  t.deepEqual(await ns.get("key", { type: type as any }), expected);
};
getMacro.title = (providedTitle) => `get: gets ${providedTitle}`;
test("text by default", getMacro, {
  value: "value",
  expected: "value",
});
test("text", getMacro, {
  value: "value",
  type: "text",
  expected: "value",
});
test("json", getMacro, {
  value: '{"field":"value"}',
  type: "json",
  expected: { field: "value" },
});
test("array buffers", getMacro, {
  value: "\x01\x02\x03",
  type: "arrayBuffer",
  expected: new Uint8Array([1, 2, 3]).buffer,
});
test("get: gets streams", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", { value: new Uint8Array([1, 2, 3]) });
  const value = await ns.get("key", "stream");
  if (value === null) return t.fail();
  const reader = value.getReader();
  let read = await reader.read();
  t.false(read.done);
  t.deepEqual(read.value, new Uint8Array([1, 2, 3]));
  read = await reader.read();
  t.true(read.done);
  t.is(read.value, undefined);
});
test("get: returns null for non-existent keys", async (t) => {
  const { ns } = t.context;
  t.is(await ns.get("key"), null);
});
test("get: returns null for expired keys", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", {
    value: utf8Encode("value"),
    expiration: TIME_EXPIRED,
  });
  t.is(await ns.get("key"), null);
});
test("get: ignores cache ttl", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", { value: utf8Encode('{"field":"value"}') });
  t.is(
    await ns.get("key", { type: undefined, cacheTtl: 3600 }),
    '{"field":"value"}'
  );
  t.deepEqual(await ns.get("key", { type: "json", cacheTtl: 3600 }), {
    field: "value",
  });
});

const getWithMetadataMacro: Macro<
  [{ value: string; type?: KVGetValueType; expected: any }],
  Context
> = async (t, { value, type, expected }) => {
  const { storage, ns } = t.context;
  await storage.put("key", {
    value: utf8Encode(value),
    metadata: { testing: true },
  });
  // Test both ways of specifying the type
  t.deepEqual(await ns.getWithMetadata("key", type as any), {
    value: expected,
    metadata: { testing: true },
  });
  t.deepEqual(await ns.getWithMetadata("key", { type: type as any }), {
    value: expected,
    metadata: { testing: true },
  });
};
getWithMetadataMacro.title = (providedTitle) =>
  `getWithMetadata: gets ${providedTitle} with metadata`;
test("text by default", getWithMetadataMacro, {
  value: "value",
  expected: "value",
});
test("text", getWithMetadataMacro, {
  value: "value",
  type: "text",
  expected: "value",
});
test("json", getWithMetadataMacro, {
  value: '{"field":"value"}',
  type: "json",
  expected: { field: "value" },
});
test("array buffers", getWithMetadataMacro, {
  value: "\x01\x02\x03",
  type: "arrayBuffer",
  expected: new Uint8Array([1, 2, 3]).buffer,
});
test("getWithMetadata: gets streams with metadata", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", {
    value: new Uint8Array([1, 2, 3]),
    metadata: { testing: true },
  });
  const { value, metadata } = await ns.getWithMetadata("key", "stream");
  if (value === null) return t.fail();
  // Check stream contents
  const reader = value.getReader();
  let read = await reader.read();
  t.false(read.done);
  t.deepEqual(read.value, new Uint8Array([1, 2, 3]));
  read = await reader.read();
  t.true(read.done);
  t.is(read.value, undefined);
  // Check metadata
  t.deepEqual(metadata, { testing: true });
});
test("getWithMetadata: returns null for non-existent keys with metadata", async (t) => {
  const { ns } = t.context;
  t.deepEqual(await ns.getWithMetadata("key"), { value: null, metadata: null });
});
test("getWithMetadata: returns null for expired keys with metadata", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", {
    value: utf8Encode("value"),
    expiration: TIME_EXPIRED,
    metadata: { testing: true },
  });
  t.deepEqual(await ns.getWithMetadata("key"), { value: null, metadata: null });
});
test("getWithMetadata: ignores cache ttl", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", {
    value: utf8Encode('{"field":"value"}'),
    metadata: { testing: true },
  });
  t.deepEqual(
    await ns.getWithMetadata("key", { type: undefined, cacheTtl: 3600 }),
    {
      value: '{"field":"value"}',
      metadata: { testing: true },
    }
  );
  t.deepEqual(
    await ns.getWithMetadata("key", { type: "json", cacheTtl: 3600 }),
    {
      value: { field: "value" },
      metadata: { testing: true },
    }
  );
});

const putMacro: Macro<
  [
    { value: KVPutValueType; options?: KVPutOptions; expected: StoredValueMeta }
  ],
  Context
> = async (t, { value, options, expected }) => {
  const { storage, ns } = t.context;
  await ns.put("key", value, options);
  t.deepEqual(await storage.get("key"), {
    value: expected.value,
    // Make sure expiration and metadata are in expected result if undefined
    expiration: expected.expiration,
    metadata: expected.metadata,
  });
};
putMacro.title = (providedTitle) => `put: puts ${providedTitle}`;
test("text", putMacro, {
  value: "value",
  expected: { value: utf8Encode("value") },
});
test("streams", putMacro, {
  value: new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("array buffers", putMacro, {
  value: new Uint8Array([1, 2, 3]).buffer,
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("text with expiration", putMacro, {
  value: "value",
  options: { expiration: TIME_EXPIRING },
  expected: { value: utf8Encode("value"), expiration: TIME_EXPIRING },
});
test("text with string expiration", putMacro, {
  value: "value",
  options: { expiration: TIME_EXPIRING.toString() },
  expected: { value: utf8Encode("value"), expiration: TIME_EXPIRING },
});
test("text with expiration ttl", putMacro, {
  value: "value",
  options: { expirationTtl: 1000 },
  expected: { value: utf8Encode("value"), expiration: TIME_NOW + 1000 },
});
test("text with string expiration ttl", putMacro, {
  value: "value",
  options: { expirationTtl: "1000" },
  expected: { value: utf8Encode("value"), expiration: TIME_NOW + 1000 },
});
test("text with metadata", putMacro, {
  value: "value",
  options: { metadata: { testing: true } },
  expected: { value: utf8Encode("value"), metadata: { testing: true } },
});
test("text with expiration and metadata", putMacro, {
  value: "value",
  options: { expiration: TIME_EXPIRING, metadata: { testing: true } },
  expected: {
    value: utf8Encode("value"),
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  },
});
test("text with expiration ttl and metadata", putMacro, {
  value: "value",
  options: { expirationTtl: 1000, metadata: { testing: true } },
  expected: {
    value: utf8Encode("value"),
    expiration: TIME_NOW + 1000,
    metadata: { testing: true },
  },
});
test("put: overrides existing keys", async (t) => {
  const { storage, ns } = t.context;
  await ns.put("key", "value1");
  await ns.put("key", "value2", {
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  });
  t.deepEqual(await storage.get("key"), {
    value: utf8Encode("value2"),
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  });
});

test("delete: deletes existing keys", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key", { value: utf8Encode("value") });
  t.not(await storage.get("key"), undefined);
  await ns.delete("key");
  t.is(await storage.get("key"), undefined);
});
test("delete: does nothing for non-existent keys", async (t) => {
  const { ns } = t.context;
  await ns.delete("key");
  await t.pass();
});

const listMacro: Macro<
  [
    {
      values: Record<string, StoredValueMeta>;
      options?: KVListOptions;
      pages: StoredKeyMeta[][];
    }
  ],
  Context
> = async (t, { values, options = {}, pages }) => {
  const { storage, ns } = t.context;
  for (const [key, value] of Object.entries(values)) {
    await storage.put(key, value);
  }

  let lastCursor = "";
  for (let i = 0; i < pages.length; i++) {
    const { keys, list_complete, cursor } = await ns.list({
      prefix: options.prefix,
      limit: options.limit,
      cursor: options.cursor ?? lastCursor,
    });
    t.deepEqual(
      keys,
      pages[i].map((value) => ({
        expiration: undefined,
        metadata: undefined,
        ...value,
      }))
    );
    if (i === pages.length - 1) {
      // Last Page
      t.true(list_complete);
      t.is(cursor, "");
    } else {
      t.false(list_complete);
      t.not(cursor, "");
    }
    lastCursor = cursor;
  }
};
listMacro.title = (providedTitle) => `list: ${providedTitle}`;
test("lists keys in sorted order", listMacro, {
  values: {
    key3: { value: utf8Encode("value3") },
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
  },
  pages: [[{ name: "key1" }, { name: "key2" }, { name: "key3" }]],
});
test("lists keys matching prefix", listMacro, {
  values: {
    section1key1: { value: utf8Encode("value11") },
    section1key2: { value: utf8Encode("value12") },
    section2key1: { value: utf8Encode("value21") },
  },
  options: { prefix: "section1" },
  pages: [[{ name: "section1key1" }, { name: "section1key2" }]],
});
test("lists keys with expiration", listMacro, {
  values: {
    key1: { value: utf8Encode("value1"), expiration: TIME_EXPIRING },
    key2: { value: utf8Encode("value2"), expiration: TIME_EXPIRING + 100 },
    key3: { value: utf8Encode("value3"), expiration: TIME_EXPIRING + 200 },
  },
  pages: [
    [
      { name: "key1", expiration: TIME_EXPIRING },
      { name: "key2", expiration: TIME_EXPIRING + 100 },
      { name: "key3", expiration: TIME_EXPIRING + 200 },
    ],
  ],
});
test("lists keys with metadata", listMacro, {
  values: {
    key1: { value: utf8Encode("value1"), metadata: { testing: 1 } },
    key2: { value: utf8Encode("value2"), metadata: { testing: 2 } },
    key3: { value: utf8Encode("value3"), metadata: { testing: 3 } },
  },
  pages: [
    [
      { name: "key1", metadata: { testing: 1 } },
      { name: "key2", metadata: { testing: 2 } },
      { name: "key3", metadata: { testing: 3 } },
    ],
  ],
});
test("lists keys with expiration and metadata", listMacro, {
  values: {
    key1: {
      value: utf8Encode("value1"),
      expiration: TIME_EXPIRING,
      metadata: { testing: 1 },
    },
    key2: {
      value: utf8Encode("value2"),
      expiration: TIME_EXPIRING + 100,
      metadata: { testing: 2 },
    },
    key3: {
      value: utf8Encode("value3"),
      expiration: TIME_EXPIRING + 200,
      metadata: { testing: 3 },
    },
  },
  pages: [
    [
      {
        name: "key1",
        expiration: TIME_EXPIRING,
        metadata: { testing: 1 },
      },
      {
        name: "key2",
        expiration: TIME_EXPIRING + 100,
        metadata: { testing: 2 },
      },
      {
        name: "key3",
        expiration: TIME_EXPIRING + 200,
        metadata: { testing: 3 },
      },
    ],
  ],
});
test("returns an empty list with no keys", listMacro, {
  values: {},
  pages: [[]],
});
test("returns an empty list with no matching keys", listMacro, {
  values: {
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
    key3: { value: utf8Encode("value3") },
  },
  options: { prefix: "none" },
  pages: [[]],
});
test("returns an empty list with an invalid cursor", listMacro, {
  values: {
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
    key3: { value: utf8Encode("value3") },
  },
  options: { cursor: base64Encode("bad") },
  pages: [[]],
});
test("paginates keys", listMacro, {
  values: {
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
    key3: { value: utf8Encode("value3") },
  },
  options: { limit: 2 },
  pages: [[{ name: "key1" }, { name: "key2" }], [{ name: "key3" }]],
});
test("paginates keys matching prefix", listMacro, {
  values: {
    section1key1: { value: utf8Encode("value11") },
    section1key2: { value: utf8Encode("value12") },
    section1key3: { value: utf8Encode("value13") },
    section2key1: { value: utf8Encode("value21") },
  },
  options: { prefix: "section1", limit: 2 },
  pages: [
    [{ name: "section1key1" }, { name: "section1key2" }],
    [{ name: "section1key3" }],
  ],
});
test("list: paginates with variable limit", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key1", { value: utf8Encode("value1") });
  await storage.put("key2", { value: utf8Encode("value2") });
  await storage.put("key3", { value: utf8Encode("value3") });

  // Get first page
  let page = await ns.list({ limit: 1 });
  t.deepEqual(page.keys, [
    { name: "key1", expiration: undefined, metadata: undefined },
  ]);
  t.false(page.list_complete);
  t.not(page.cursor, "");

  // Get second page with different limit
  page = await ns.list({ limit: 2, cursor: page.cursor });
  t.deepEqual(page.keys, [
    { name: "key2", expiration: undefined, metadata: undefined },
    { name: "key3", expiration: undefined, metadata: undefined },
  ]);
  t.true(page.list_complete);
  t.is(page.cursor, "");
});
test("list: returns keys inserted whilst paginating", async (t) => {
  const { storage, ns } = t.context;
  await storage.put("key1", { value: utf8Encode("value1") });
  await storage.put("key3", { value: utf8Encode("value3") });
  await storage.put("key5", { value: utf8Encode("value5") });

  // Get first page
  let page = await ns.list({ limit: 2 });
  t.deepEqual(page.keys, [
    { name: "key1", expiration: undefined, metadata: undefined },
    { name: "key3", expiration: undefined, metadata: undefined },
  ]);
  t.false(page.list_complete);
  t.not(page.cursor, "");

  // Insert key2 and key4
  await storage.put("key2", { value: utf8Encode("value2") });
  await storage.put("key4", { value: utf8Encode("value4") });

  // Get second page, expecting to see key4 but not key2
  page = await ns.list({ limit: 2, cursor: page.cursor });
  t.deepEqual(page.keys, [
    { name: "key4", expiration: undefined, metadata: undefined },
    { name: "key5", expiration: undefined, metadata: undefined },
  ]);
  t.true(page.list_complete);
  t.is(page.cursor, "");
});
test("list: ignores expired keys", async (t) => {
  const { storage, ns } = t.context;
  for (let i = 1; i <= 3; i++) {
    await storage.put(`key${i}`, {
      value: utf8Encode(`value${i}`),
      expiration: i * 100,
    });
  }
  t.deepEqual(await ns.list(), { keys: [], list_complete: true, cursor: "" });
});

test("hides implementation details", (t) => {
  const { ns } = t.context;
  t.deepEqual(getObjectProperties(ns), [
    "delete",
    "get",
    "getWithMetadata",
    "list",
    "put",
  ]);
});
