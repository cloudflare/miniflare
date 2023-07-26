import assert from "assert";
import { Blob } from "buffer";
import { text } from "stream/consumers";
import type {
  KVNamespaceListOptions,
  KVNamespaceListResult,
} from "@cloudflare/workers-types/experimental";
import { Macro, ThrowsExpectation } from "ava";
import { KVNamespace, KeyValueStorage, MiniflareOptions } from "miniflare";
import {
  MiniflareTestContext,
  Namespaced,
  createJunkStream,
  miniflareTest,
  namespace,
} from "../../test-shared";

// Stored expiration value to signal an expired key.
export const TIME_EXPIRED = 500;
// Time in seconds the testClock always returns:
// TIME_EXPIRED < TIME_NOW < TIME_EXPIRING
export const TIME_NOW = 1000;
// Stored expiration value to signal a key that will expire in the future.
export const TIME_EXPIRING = 1500;

interface Context extends MiniflareTestContext {
  ns: string;
  kv: Namespaced<KVNamespace>; // :D
  storage: KeyValueStorage;
}

const opts: Partial<MiniflareOptions> = {
  kvNamespaces: { NAMESPACE: "namespace" },
};
const test = miniflareTest<unknown, Context>(opts, async (global) => {
  return new global.Response(null, { status: 404 });
});

test.beforeEach(async (t) => {
  // Namespace keys so tests which are accessing the same Miniflare instance
  // and bucket don't have races from key collisions
  const ns = `${Date.now()}_${Math.floor(
    Math.random() * Number.MAX_SAFE_INTEGER
  )}`;
  t.context.ns = ns;
  t.context.kv = namespace(ns, await t.context.mf.getKVNamespace("NAMESPACE"));
  const storage = t.context.mf._getPluginStorage("kv", "namespace");
  t.context.storage = new KeyValueStorage(storage, t.context.timers);
});

const validatesKeyMacro: Macro<
  [method: string, func: (kv: KVNamespace, key?: any) => Promise<void>],
  Context
> = {
  title(providedTitle, method) {
    return `${method}: validates key`;
  },
  async exec(t, method, func) {
    const { kv } = t.context;
    kv.ns = "";
    await t.throwsAsync(func(kv, ""), {
      instanceOf: TypeError,
      message: "Key name cannot be empty.",
    });
    await t.throwsAsync(func(kv, "."), {
      instanceOf: TypeError,
      message: '"." is not allowed as a key name.',
    });
    await t.throwsAsync(func(kv, ".."), {
      instanceOf: TypeError,
      message: '".." is not allowed as a key name.',
    });
    await t.throwsAsync(func(kv, "".padStart(513, "x")), {
      instanceOf: Error,
      message: `KV ${method.toUpperCase()} failed: 414 UTF-8 encoded length of 513 exceeds key length limit of 512.`,
    });
  },
};

test(validatesKeyMacro, "get", async (kv, key) => {
  await kv.get(key);
});
test("get: returns value", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({
    key: `${ns}key`,
    value: new Blob(["value"]).stream(),
    metadata: { testing: true },
  });
  const result = await kv.get("key");
  t.is(result, "value");
});
test("get: returns null for non-existent keys", async (t) => {
  const { kv } = t.context;
  t.is(await kv.get("key"), null);
});
test("get: returns null for expired keys", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({
    key: `${ns}key`,
    value: new Blob(["value"]).stream(),
    expiration: TIME_EXPIRED,
  });
  t.is(await kv.get("key"), null);
});
test("get: validates but ignores cache ttl", async (t) => {
  const { storage, kv } = t.context;
  await storage.put({
    key: "key",
    value: new Blob(["value"]).stream(),
  });
  await t.throwsAsync(kv.get("key", { cacheTtl: "not a number" as any }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid cache_ttl of 0. Cache TTL must be at least 60.",
  });
  await t.throwsAsync(kv.get("key", { cacheTtl: 10 }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid cache_ttl of 10. Cache TTL must be at least 60.",
  });
  t.not(await kv.get("key", { cacheTtl: 60 }), undefined);
});

test(validatesKeyMacro, "put", async (kv, key) => {
  await kv.put(key, new Blob(["value"]).stream());
});
test("put: puts value", async (t) => {
  const { storage, kv, ns } = t.context;
  await kv.put("key", new Blob(["value"]).stream(), {
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  });
  const result = await storage.get(`${ns}key`);
  assert(result !== null);
  t.deepEqual(result, {
    key: `${ns}key`,
    value: result.value,
    expiration: TIME_EXPIRING * 1000,
    metadata: { testing: true },
  });
  t.is(await text(result.value), "value");
});
test("put: overrides existing keys", async (t) => {
  const { storage, kv, ns } = t.context;
  await kv.put("key", new Blob(["value1"]).stream());
  await kv.put("key", new Blob(["value2"]).stream(), {
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  });
  const result = await storage.get(`${ns}key`);
  assert(result !== null);
  t.deepEqual(result, {
    key: `${ns}key`,
    value: result.value,
    expiration: TIME_EXPIRING * 1000,
    metadata: { testing: true },
  });
  t.is(await text(result.value), "value2");
});
test("put: keys are case-sensitive", async (t) => {
  const { kv } = t.context;
  await kv.put("key", new Blob(["lower"]).stream());
  await kv.put("KEY", new Blob(["upper"]).stream());
  let result = await kv.get("key");
  t.is(result, "lower");
  result = await kv.get("KEY");
  t.is(result, "upper");
});
test("put: validates expiration ttl", async (t) => {
  const { kv } = t.context;
  const blob = new Blob(["value1"]);
  const value = () => blob.stream();
  await t.throwsAsync(
    kv.put("key", value(), { expirationTtl: "nan" as unknown as number }),
    {
      instanceOf: Error,
      message:
        "KV PUT failed: 400 Invalid expiration_ttl of 0. Please specify integer greater than 0.",
    }
  );
  await t.throwsAsync(kv.put("key", value(), { expirationTtl: 0 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 0. Please specify integer greater than 0.",
  });
  await t.throwsAsync(kv.put("key", value(), { expirationTtl: 30 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.",
  });
});
test("put: validates expiration", async (t) => {
  const { kv } = t.context;
  const blob = new Blob(["value"]);
  const value = () => blob.stream();
  await t.throwsAsync(
    kv.put("key", value(), { expiration: "nan" as unknown as number }),
    {
      instanceOf: Error,
      message:
        "KV PUT failed: 400 Invalid expiration of 0. Please specify integer greater than the current number of seconds since the UNIX epoch.",
    }
  );
  await t.throwsAsync(kv.put("key", value(), { expiration: TIME_NOW }), {
    instanceOf: Error,

    message: `KV PUT failed: 400 Invalid expiration of ${TIME_NOW}. Please specify integer greater than the current number of seconds since the UNIX epoch.`,
  });
  await t.throwsAsync(kv.put("key", value(), { expiration: TIME_NOW + 30 }), {
    instanceOf: Error,
    message: `KV PUT failed: 400 Invalid expiration of ${
      TIME_NOW + 30
    }. Expiration times must be at least 60 seconds in the future.`,
  });
});
test("put: validates value size", async (t) => {
  const { kv } = t.context;
  const maxValueSize = 25 * 1024 * 1024;
  const byteLength = maxValueSize + 1;
  const expectations: ThrowsExpectation<Error> = {
    instanceOf: Error,
    message: `KV PUT failed: 413 Value length of ${byteLength} exceeds limit of ${maxValueSize}.`,
  };
  // Check with and without `valueLengthHint`
  await t.throwsAsync(
    kv.put("key", createJunkStream(byteLength)),
    expectations
  );
  // Check 1 less byte is accepted
  await kv.put("key", createJunkStream(byteLength - 1));
});
test("put: validates metadata size", async (t) => {
  const { kv } = t.context;
  const maxMetadataSize = 1024;
  await t.throwsAsync(
    kv.put("key", new Blob(["value"]).stream(), {
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

test(validatesKeyMacro, "delete", async (kv, key) => {
  await kv.delete(key);
});
test("delete: deletes existing keys", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({
    key: `${ns}key`,
    value: new Blob(["value"]).stream(),
  });
  t.not(await storage.get(`${ns}key`), null);
  await kv.delete("key");
  t.is(await storage.get(`${ns}key`), null);
});
test("delete: does nothing for non-existent keys", async (t) => {
  const { kv } = t.context;
  await kv.delete("key");
  t.pass();
});

const listMacro: Macro<
  [
    {
      values: Record<
        string,
        { value: string; expiration?: number; metadata?: unknown }
      >;
      options?: KVNamespaceListOptions;
      pages: KVNamespaceListResult<unknown>["keys"][];
    }
  ],
  Context
> = {
  title(providedTitle) {
    return `list: ${providedTitle}`;
  },
  async exec(t, { values, options = {}, pages }) {
    const { storage, kv, ns } = t.context;
    for (const [key, value] of Object.entries(values)) {
      await storage.put({
        key: ns + key,
        value: new Blob([value.value]).stream(),
        expiration:
          value.expiration === undefined ? undefined : value.expiration * 1000,
        metadata: value.metadata,
      });
    }

    let lastCursor = "";
    for (let i = 0; i < pages.length; i++) {
      const result = await kv.list({
        prefix: ns + (options.prefix ?? ""),
        limit: options.limit,
        cursor: options.cursor ?? lastCursor,
      });
      t.deepEqual(
        result.keys,
        pages[i].map((value) => ({
          ...value,
          name: ns + value.name,
        }))
      );
      if (i === pages.length - 1) {
        // Last Page
        assert(result.list_complete && !("cursor" in result));
        lastCursor = "";
      } else {
        // noinspection SuspiciousTypeOfGuard
        assert(!result.list_complete && typeof result.cursor === "string");
        lastCursor = result.cursor;
      }
    }
  },
};
test("lists keys in sorted order", listMacro, {
  values: {
    key3: { value: "value3" },
    key1: { value: "value1" },
    key2: { value: "value2" },
  },
  pages: [[{ name: "key1" }, { name: "key2" }, { name: "key3" }]],
});
test("lists keys matching prefix", listMacro, {
  values: {
    section1key1: { value: "value11" },
    section1key2: { value: "value12" },
    section2key1: { value: "value21" },
  },
  options: { prefix: "section1" },
  pages: [[{ name: "section1key1" }, { name: "section1key2" }]],
});
test("prefix is case-sensitive", listMacro, {
  values: {
    key1: { value: "lower1" },
    key2: { value: "lower2 " },
    KEY1: { value: "upper1" },
    KEY2: { value: "upper2" },
  },
  options: { prefix: "KEY" },
  pages: [[{ name: "KEY1" }, { name: "KEY2" }]],
});
test("prefix permits special characters", listMacro, {
  values: {
    ["key\\_%1"]: { value: "value1" },
    ["key\\a"]: { value: "bad1" },
    ["key\\_%2"]: { value: "value2" },
    ["key\\bbb"]: { value: "bad2" },
    ["key\\_%3"]: { value: "value3" },
  },
  options: { prefix: "key\\_%" },
  pages: [[{ name: "key\\_%1" }, { name: "key\\_%2" }, { name: "key\\_%3" }]],
});
test("lists keys with expiration", listMacro, {
  values: {
    key1: { value: "value1", expiration: TIME_EXPIRING },
    key2: { value: "value2", expiration: TIME_EXPIRING + 100 },
    key3: { value: "value3", expiration: TIME_EXPIRING + 200 },
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
    key1: { value: "value1", metadata: { testing: 1 } },
    key2: { value: "value2", metadata: { testing: 2 } },
    key3: { value: "value3", metadata: { testing: 3 } },
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
      value: "value1",
      expiration: TIME_EXPIRING,
      metadata: { testing: 1 },
    },
    key2: {
      value: "value2",
      expiration: TIME_EXPIRING + 100,
      metadata: { testing: 2 },
    },
    key3: {
      value: "value3",
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
    key1: { value: "value1" },
    key2: { value: "value2" },
    key3: { value: "value3" },
  },
  options: { prefix: "none" },
  pages: [[]],
});
test("paginates keys", listMacro, {
  values: {
    key1: { value: "value1" },
    key2: { value: "value2" },
    key3: { value: "value3" },
  },
  options: { limit: 2 },
  pages: [[{ name: "key1" }, { name: "key2" }], [{ name: "key3" }]],
});
test("paginates keys matching prefix", listMacro, {
  values: {
    section1key1: { value: "value11" },
    section1key2: { value: "value12" },
    section1key3: { value: "value13" },
    section2key1: { value: "value21" },
  },
  options: { prefix: "section1", limit: 2 },
  pages: [
    [{ name: "section1key1" }, { name: "section1key2" }],
    [{ name: "section1key3" }],
  ],
});
test("list: paginates with variable limit", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({ key: `${ns}key1`, value: new Blob(["value1"]).stream() });
  await storage.put({ key: `${ns}key2`, value: new Blob(["value2"]).stream() });
  await storage.put({ key: `${ns}key3`, value: new Blob(["value3"]).stream() });

  // Get first page
  let page = await kv.list({ prefix: ns, limit: 1 });
  t.deepEqual(page.keys, [{ name: `${ns}key1` }]);
  assert(!page.list_complete);
  t.not(page.cursor, undefined);

  // Get second page with different limit
  page = await kv.list({ prefix: ns, limit: 2, cursor: page.cursor });
  t.deepEqual(page.keys, [{ name: `${ns}key2` }, { name: `${ns}key3` }]);
  assert(page.list_complete);
});
test("list: returns keys inserted whilst paginating", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({ key: `${ns}key1`, value: new Blob(["value1"]).stream() });
  await storage.put({ key: `${ns}key3`, value: new Blob(["value3"]).stream() });
  await storage.put({ key: `${ns}key5`, value: new Blob(["value5"]).stream() });

  // Get first page
  let page = await kv.list({ prefix: ns, limit: 2 });
  t.deepEqual(page.keys, [{ name: `${ns}key1` }, { name: `${ns}key3` }]);
  assert(!page.list_complete);
  t.not(page.cursor, undefined);

  // Insert key2 and key4
  await storage.put({ key: `${ns}key2`, value: new Blob(["value2"]).stream() });
  await storage.put({ key: `${ns}key4`, value: new Blob(["value4"]).stream() });

  // Get second page, expecting to see key4 but not key2
  page = await kv.list({ prefix: ns, limit: 2, cursor: page.cursor });
  t.deepEqual(page.keys, [{ name: `${ns}key4` }, { name: `${ns}key5` }]);
  assert(page.list_complete);
});
test("list: ignores expired keys", async (t) => {
  const { storage, kv, ns } = t.context;
  for (let i = 1; i <= 3; i++) {
    await storage.put({
      key: `${ns}key${i}`,
      value: new Blob([`value${i}`]).stream(),
      expiration: i * 100 * 1000,
    });
  }
  t.deepEqual(await kv.list({ prefix: ns }), {
    keys: [],
    list_complete: true,
    cacheStatus: null,
  });
});
test("list: sorts lexicographically", async (t) => {
  const { storage, kv, ns } = t.context;
  await storage.put({ key: `${ns}, `, value: new Blob(["value"]).stream() });
  await storage.put({ key: `${ns}!`, value: new Blob(["value"]).stream() });
  t.deepEqual(await kv.list({ prefix: ns }), {
    keys: [{ name: `${ns}!` }, { name: `${ns}, ` }],
    list_complete: true,
    cacheStatus: null,
  });
});
test("list: validates limit", async (t) => {
  const { kv } = t.context;
  // The runtime will only send the limit if it's > 0
  await t.throwsAsync(kv.list({ limit: 1001 }), {
    instanceOf: Error,
    message:
      "KV GET failed: 400 Invalid key_count_limit of 1001. Please specify an integer less than 1000.",
  });
});
