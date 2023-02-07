import assert from "assert";
import { ReadableStream } from "stream/web";
import {
  KVGetValueType,
  KVListOptions,
  KVNamespace,
  KVPutOptions,
  KVPutValueType,
} from "@miniflare/kv";
import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  RequestContextOptions,
  Storage,
  StoredKeyMeta,
  StoredValueMeta,
  base64Encode,
} from "@miniflare/shared";
import {
  TIME_EXPIRED,
  TIME_EXPIRING,
  TIME_NOW,
  advancesTime,
  getObjectProperties,
  testClock,
  utf8Decode,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { Macro, TestInterface, ThrowsExpectation } from "ava";

const requestCtxOptions: RequestContextOptions = {
  externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
};

interface Context {
  storage: Storage;
  ns: KVNamespace;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const storage = new MemoryStorage(undefined, testClock);
  const ns = new KVNamespace(storage, { clock: testClock });
  t.context = { storage, ns };
});

const validatesKeyMacro: Macro<
  [
    method: string,
    httpMethod: string,
    func: (ns: KVNamespace, key?: any) => Promise<void>
  ],
  Context
> = async (t, method, httpMethod, func) => {
  const { ns } = t.context;
  await t.throwsAsync(func(ns), {
    instanceOf: TypeError,
    message: `Failed to execute '${method}' on 'KvNamespace': parameter 1 is not of type 'string'.`,
  });
  await t.throwsAsync(func(ns, 0), {
    instanceOf: TypeError,
    message: `Failed to execute '${method}' on 'KvNamespace': parameter 1 is not of type 'string'.`,
  });
  await t.throwsAsync(func(ns, ""), {
    instanceOf: TypeError,
    message: "Key name cannot be empty.",
  });
  await t.throwsAsync(func(ns, "."), {
    instanceOf: TypeError,
    message: '"." is not allowed as a key name.',
  });
  await t.throwsAsync(func(ns, ".."), {
    instanceOf: TypeError,
    message: '".." is not allowed as a key name.',
  });
  await t.throwsAsync(func(ns, "".padStart(513, "x")), {
    instanceOf: Error,
    message: `KV ${httpMethod} failed: 414 UTF-8 encoded length of 513 exceeds key length limit of 512.`,
  });
};
validatesKeyMacro.title = (providedTitle, method) => `${method}: validates key`;
const validateGetMacro: Macro<
  [func: (ns: KVNamespace, cacheTtl?: number, type?: string) => Promise<void>],
  Context
> = async (t, func) => {
  const { ns } = t.context;
  await t.throwsAsync(func(ns, "not a number" as any), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid cache_ttl of not a number. Cache TTL must be at least 60.",
  });
  await t.throwsAsync(func(ns, 10), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid cache_ttl of 10. Cache TTL must be at least 60.",
  });
  await t.throwsAsync(func(ns, 120, "map"), {
    instanceOf: TypeError,
    message:
      'Unknown response type. Possible types are "text", "arrayBuffer", "json", and "stream".',
  });
};
validateGetMacro.title = (providedTitle) =>
  `${providedTitle}: validates get options`;

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
test("get: increments subrequest count", async (t) => {
  const { ns } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => ns.get("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("get: waits for input gate to open before returning", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  await waitsForInputGate(t, () => ns.get("key"));
});
test("get: waits for input gate to open before returning with non-existent key", async (t) => {
  const { ns } = t.context;
  await waitsForInputGate(t, () => ns.get("key"));
});
test("get: waits for input gate to open before returning stream chunk", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  const stream = await waitsForInputGate(t, () => ns.get("key", "stream"));
  assert(stream);
  const chunk = await waitsForInputGate(t, () => stream.getReader().read());
  t.is(utf8Decode(chunk.value), "value");
});
test(validatesKeyMacro, "get", "GET", async (ns, key) => {
  await ns.get(key);
});
test("get", validateGetMacro, async (ns, cacheTtl, type) => {
  await ns.get("key", { cacheTtl, type: type as any });
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
test("getWithMetadata: increments subrequest count", async (t) => {
  const { ns } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => ns.getWithMetadata("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("getWithMetadata: waits for input gate to open before returning", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  await waitsForInputGate(t, () => ns.getWithMetadata("key"));
});
test("getWithMetadata: waits for input gate to open before returning with non-existent key", async (t) => {
  const { ns } = t.context;
  await waitsForInputGate(t, () => ns.getWithMetadata("key"));
});
test("getWithMetadata: waits for input gate to open before returning stream chunk", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  const { value } = await waitsForInputGate(t, () =>
    ns.getWithMetadata("key", "stream")
  );
  assert(value);
  const chunk = await waitsForInputGate(t, () => value.getReader().read());
  t.is(utf8Decode(chunk.value), "value");
});
test(validatesKeyMacro, "getWithMetadata", "GET", async (ns, key) => {
  await ns.getWithMetadata(key);
});
test("getWithMetadata", validateGetMacro, async (ns, cacheTtl, type) => {
  await ns.getWithMetadata("key", { cacheTtl, type: type as any });
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
test("array buffer views", putMacro, {
  value: new DataView(new Uint8Array([1, 2, 3]).buffer),
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
test("put: increments subrequest count", async (t) => {
  const { ns } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => ns.put("key", "value"));
  t.is(ctx.internalSubrequests, 1);
});
test("put: waits for output gate to open before storing", async (t) => {
  const { ns } = t.context;
  await waitsForOutputGate(
    t,
    () => ns.put("key", "value"),
    () => ns.get("key")
  );
});
test("put: waits for input gate to open before returning", async (t) => {
  const { ns } = t.context;
  await waitsForInputGate(t, () => ns.put("key", "value"));
});
test(validatesKeyMacro, "put", "PUT", async (ns, key) => {
  await ns.put(key, "value");
});
test("put: validates value type", async (t) => {
  const { ns } = t.context;
  await t.throwsAsync(ns.put("key", new Map() as any), {
    instanceOf: TypeError,
    message:
      "KV put() accepts only strings, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values.",
  });
});
test("put: validates expiration ttl", async (t) => {
  const { ns } = t.context;
  await t.throwsAsync(ns.put("key", "value", { expirationTtl: "nan" }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of nan. Please specify integer greater than 0.",
  });
  await t.throwsAsync(ns.put("key", "value", { expirationTtl: 0 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 0. Please specify integer greater than 0.",
  });
  await t.throwsAsync(ns.put("key", "value", { expirationTtl: 30 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.",
  });
  await t.throwsAsync(ns.put("key", "value", { expirationTtl: 2147483648 }), {
    instanceOf: TypeError,
    message:
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
  });
  await t.throwsAsync(ns.put("key", "value", { expirationTtl: -2147483649 }), {
    instanceOf: TypeError,
    message:
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
  });
});
test("put: validates expiration", async (t) => {
  const { ns } = t.context;
  await t.throwsAsync(ns.put("key", "value", { expiration: "nan" }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration of nan. Please specify integer greater than the current number of seconds since the UNIX epoch.",
  });
  // testClock sets current time to 750s since UNIX epoch
  await t.throwsAsync(ns.put("key", "value", { expiration: 750 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration of 750. Please specify integer greater than the current number of seconds since the UNIX epoch.",
  });
  await t.throwsAsync(ns.put("key", "value", { expiration: 780 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration of 780. Expiration times must be at least 60 seconds in the future.",
  });
  await t.throwsAsync(ns.put("key", "value", { expiration: 2147483648 }), {
    instanceOf: TypeError,
    message:
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
  });
  await t.throwsAsync(ns.put("key", "value", { expiration: -2147483649 }), {
    instanceOf: TypeError,
    message:
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
  });
});
test("put: validates value size", async (t) => {
  const { ns } = t.context;
  const maxValueSize = 25 * 1024 * 1024;
  const byteLength = maxValueSize + 1;
  await t.throwsAsync(ns.put("key", new Uint8Array(byteLength)), {
    instanceOf: Error,
    message: `KV PUT failed: 413 Value length of ${byteLength} exceeds limit of ${maxValueSize}.`,
  });
});
test("put: validates metadata size", async (t) => {
  const { ns } = t.context;
  const maxMetadataSize = 1024;
  await t.throwsAsync(
    ns.put("key", "value", {
      metadata: {
        key: "".padStart(maxMetadataSize - `{\"key\":\"\"}`.length + 1, "x"),
      },
    }),
    {
      instanceOf: Error,
      message: `KV PUT failed: 413 Metadata length of ${
        maxMetadataSize + 1
      } exceeds limit of ${maxMetadataSize}.`,
    }
  );
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
test("delete: increments subrequest count", async (t) => {
  const { ns } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => ns.delete("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("delete: waits for output gate to open before deleting", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  await waitsForOutputGate(
    t,
    () => ns.delete("key"),
    async () => !(await ns.get("key"))
  );
});
test("delete: waits for input gate to open before returning", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  await waitsForInputGate(t, () => ns.delete("key"));
});
test(validatesKeyMacro, "delete", "DELETE", async (ns, key) => {
  await ns.delete(key);
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
test("list: sorts lexicographically", async (t) => {
  const { storage, ns } = t.context;
  await storage.put(", ", { value: utf8Encode("value") });
  await storage.put("!", { value: utf8Encode("value") });
  t.deepEqual(await ns.list(), {
    keys: [
      { name: "!", expiration: undefined, metadata: undefined },
      { name: ", ", expiration: undefined, metadata: undefined },
    ],
    list_complete: true,
    cursor: "",
  });
});
test("list: increments subrequest count", async (t) => {
  const { ns } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => ns.list());
  t.is(ctx.internalSubrequests, 1);
});
test("list: waits for input gate to open before returning", async (t) => {
  const { ns } = t.context;
  await ns.put("key", "value");
  await waitsForInputGate(t, () => ns.list());
});
test("list: validates limit", async (t) => {
  const { ns } = t.context;
  await t.throwsAsync(ns.list({ limit: "nan" as any }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid key_count_limit of nan. Please specify an integer greater than 0.",
  });
  await t.throwsAsync(ns.list({ limit: 0 }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid key_count_limit of 0. Please specify an integer greater than 0.",
  });
  await t.throwsAsync(ns.list({ limit: 1001 }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid key_count_limit of 1001. Please specify an integer less than 1000.",
  });
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
test("operations throw outside request handler", async (t) => {
  const ns = new KVNamespace(new MemoryStorage(), { blockGlobalAsyncIO: true });
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };
  await t.throwsAsync(ns.get("key"), expectations);
  await t.throwsAsync(ns.getWithMetadata("key"), expectations);
  await t.throwsAsync(ns.put("key", "value"), expectations);
  await t.throwsAsync(ns.delete("key"), expectations);
  await t.throwsAsync(ns.list(), expectations);

  await ctx.runWith(() => ns.get("key"));
  await ctx.runWith(() => ns.getWithMetadata("key"));
  await ctx.runWith(() => ns.put("key", "value"));
  await ctx.runWith(() => ns.delete("key"));
  await ctx.runWith(() => ns.list());
});
test("operations advance current time", async (t) => {
  const { ns } = t.context;
  await advancesTime(t, () => ns.get("key"));
  await advancesTime(t, () => ns.getWithMetadata("key"));
  await advancesTime(t, () => ns.put("key", "value"));
  await advancesTime(t, () => ns.delete("key"));
  await advancesTime(t, () => ns.list());
});
