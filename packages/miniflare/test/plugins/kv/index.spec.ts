import assert from "assert";
import { Blob } from "buffer";
import fs from "fs/promises";
import path from "path";
import type {
  KVNamespace,
  KVNamespaceListOptions,
  KVNamespaceListResult,
} from "@cloudflare/workers-types/experimental";
import { Macro, ThrowsExpectation } from "ava";
import {
  KV_PLUGIN_NAME,
  Miniflare,
  MiniflareOptions,
  ReplaceWorkersTypes,
} from "miniflare";
import {
  FIXTURES_PATH,
  MiniflareDurableObjectControlStub,
  MiniflareTestContext,
  Namespaced,
  createJunkStream,
  miniflareTest,
  namespace,
  useTmp,
} from "../../test-shared";

function secondsToMillis(seconds: number): number {
  return seconds * 1000;
}

// Time in seconds the fake `Date.now()` always returns
export const TIME_NOW = 1000;
// Expiration value to signal a key that will expire in the future
export const TIME_FUTURE = 1500;

interface Context extends MiniflareTestContext {
  ns: string;
  kv: Namespaced<ReplaceWorkersTypes<KVNamespace>>; // :D
  object: MiniflareDurableObjectControlStub;
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

  // Enable fake timers
  const objectNamespace = await t.context.mf._getInternalDurableObjectNamespace(
    KV_PLUGIN_NAME,
    "kv:ns",
    "KVNamespaceObject"
  );
  const objectId = objectNamespace.idFromName("namespace");
  const objectStub = objectNamespace.get(objectId);
  t.context.object = new MiniflareDurableObjectControlStub(objectStub);
  await t.context.object.enableFakeTimers(secondsToMillis(TIME_NOW));
});

const validatesKeyMacro: Macro<
  [
    method: string,
    func: (kv: ReplaceWorkersTypes<KVNamespace>, key?: any) => Promise<void>
  ],
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
  const { kv } = t.context;
  await kv.put("key", "value");
  const result = await kv.get("key");
  t.is(result, "value");
});
test("get: returns null for non-existent keys", async (t) => {
  const { kv } = t.context;
  t.is(await kv.get("key"), null);
});
test.serial("get: returns null for expired keys", async (t) => {
  const { kv, object } = t.context;
  await kv.put("key", "value", { expirationTtl: 60 });
  t.not(await kv.get("key"), null);
  await object.advanceFakeTime(60_000);
  t.is(await kv.get("key"), null);
});
test("get: validates but ignores cache ttl", async (t) => {
  const { kv } = t.context;
  await kv.put("key", "value");
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
  await kv.put(key, "value");
});
test("put: puts value", async (t) => {
  const { kv, ns } = t.context;
  await kv.put("key", "value", {
    expiration: TIME_FUTURE,
    metadata: { testing: true },
  });
  const result = await kv.getWithMetadata("key");
  t.is(result.value, "value");
  t.deepEqual(result.metadata, { testing: true });
  // Check expiration set too
  const results = await kv.list({ prefix: ns });
  t.is(results.keys[0]?.expiration, TIME_FUTURE);
});
test("put: overrides existing keys", async (t) => {
  const { kv } = t.context;
  await kv.put("key", "value1");
  await kv.put("key", "value2", {
    expiration: TIME_FUTURE,
    metadata: { testing: true },
  });
  const result = await kv.getWithMetadata("key");
  t.is(result.value, "value2");
  t.deepEqual(result.metadata, { testing: true });
});
test("put: keys are case-sensitive", async (t) => {
  const { kv } = t.context;
  await kv.put("key", "lower");
  await kv.put("KEY", "upper");
  let result = await kv.get("key");
  t.is(result, "lower");
  result = await kv.get("KEY");
  t.is(result, "upper");
});
test("put: validates expiration ttl", async (t) => {
  const { kv } = t.context;
  await t.throwsAsync(
    kv.put("key", "value", { expirationTtl: "nan" as unknown as number }),
    {
      instanceOf: Error,
      message:
        "KV PUT failed: 400 Invalid expiration_ttl of 0. Please specify integer greater than 0.",
    }
  );
  await t.throwsAsync(kv.put("key", "value", { expirationTtl: 0 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 0. Please specify integer greater than 0.",
  });
  await t.throwsAsync(kv.put("key", "value", { expirationTtl: 30 }), {
    instanceOf: Error,
    message:
      "KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.",
  });
});
test("put: validates expiration", async (t) => {
  const { kv } = t.context;
  await t.throwsAsync(
    kv.put("key", "value", { expiration: "nan" as unknown as number }),
    {
      instanceOf: Error,
      message:
        "KV PUT failed: 400 Invalid expiration of 0. Please specify integer greater than the current number of seconds since the UNIX epoch.",
    }
  );
  await t.throwsAsync(kv.put("key", "value", { expiration: TIME_NOW }), {
    instanceOf: Error,
    message: `KV PUT failed: 400 Invalid expiration of ${TIME_NOW}. Please specify integer greater than the current number of seconds since the UNIX epoch.`,
  });
  await t.throwsAsync(kv.put("key", "value", { expiration: TIME_NOW + 30 }), {
    instanceOf: Error,
    message: `KV PUT failed: 400 Invalid expiration of ${
      TIME_NOW + 30
    }. Expiration times must be at least 60 seconds in the future.`,
  });
});
test("put: validates value size", async (t) => {
  const { kv } = t.context;
  const maxValueSize = 1024;
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
  const { kv } = t.context;
  await kv.put("key", "value");
  t.not(await kv.get("key"), null);
  await kv.delete("key");
  t.is(await kv.get("key"), null);
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
    const { kv, ns } = t.context;
    for (const [key, value] of Object.entries(values)) {
      await kv.put(key, value.value, {
        expiration: value.expiration,
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
    key1: { value: "value1", expiration: TIME_FUTURE },
    key2: { value: "value2", expiration: TIME_FUTURE + 100 },
    key3: { value: "value3", expiration: TIME_FUTURE + 200 },
  },
  pages: [
    [
      { name: "key1", expiration: TIME_FUTURE },
      { name: "key2", expiration: TIME_FUTURE + 100 },
      { name: "key3", expiration: TIME_FUTURE + 200 },
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
      expiration: TIME_FUTURE,
      metadata: { testing: 1 },
    },
    key2: {
      value: "value2",
      expiration: TIME_FUTURE + 100,
      metadata: { testing: 2 },
    },
    key3: {
      value: "value3",
      expiration: TIME_FUTURE + 200,
      metadata: { testing: 3 },
    },
  },
  pages: [
    [
      {
        name: "key1",
        expiration: TIME_FUTURE,
        metadata: { testing: 1 },
      },
      {
        name: "key2",
        expiration: TIME_FUTURE + 100,
        metadata: { testing: 2 },
      },
      {
        name: "key3",
        expiration: TIME_FUTURE + 200,
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
  const { kv, ns } = t.context;
  await kv.put("key1", "value1");
  await kv.put("key2", "value2");
  await kv.put("key3", "value3");

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
  const { kv, ns } = t.context;
  await kv.put("key1", "value1");
  await kv.put("key3", "value3");
  await kv.put("key5", "value5");

  // Get first page
  let page = await kv.list({ prefix: ns, limit: 2 });
  t.deepEqual(page.keys, [{ name: `${ns}key1` }, { name: `${ns}key3` }]);
  assert(!page.list_complete);
  t.not(page.cursor, undefined);

  // Insert key2 and key4
  await kv.put("key2", "value2");
  await kv.put("key4", "value4");

  // Get second page, expecting to see key4 but not key2
  page = await kv.list({ prefix: ns, limit: 2, cursor: page.cursor });
  t.deepEqual(page.keys, [{ name: `${ns}key4` }, { name: `${ns}key5` }]);
  assert(page.list_complete);
});
test.serial("list: ignores expired keys", async (t) => {
  const { kv, ns, object } = t.context;
  for (let i = 1; i <= 3; i++) {
    await kv.put(`key${i}`, `value${i}`, { expiration: TIME_NOW + i * 60 });
  }
  await object.advanceFakeTime(130_000 /* 2m10s */);
  t.deepEqual(await kv.list({ prefix: ns }), {
    keys: [{ name: `${ns}key3`, expiration: TIME_NOW + 3 * 60 }],
    list_complete: true,
    cacheStatus: null,
  });
});
test("list: sorts lexicographically", async (t) => {
  const { kv, ns } = t.context;
  await kv.put(", ", "value");
  await kv.put("!", "value");
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

test("persists in-memory between options reloads", async (t) => {
  const opts = {
    modules: true,
    script: `export default {
      async fetch(request, env) {
        return Response.json({ version: env.VERSION, key: await env.NAMESPACE.get("key") });
      }
    }`,
    bindings: { VERSION: 1 },
    kvNamespaces: { NAMESPACE: "namespace" },
  } satisfies MiniflareOptions;
  const mf1 = new Miniflare(opts);
  t.teardown(() => mf1.dispose());

  const kv1 = await mf1.getKVNamespace("NAMESPACE");
  await kv1.put("key", "value1");
  let res = await mf1.dispatchFetch("http://placeholder");
  t.deepEqual(await res.json(), { version: 1, key: "value1" });

  opts.bindings.VERSION = 2;
  await mf1.setOptions(opts);
  res = await mf1.dispatchFetch("http://placeholder");
  t.deepEqual(await res.json(), { version: 2, key: "value1" });

  // Check a `new Miniflare()` instance has its own in-memory storage
  opts.bindings.VERSION = 3;
  const mf2 = new Miniflare(opts);
  t.teardown(() => mf2.dispose());
  const kv2 = await mf2.getKVNamespace("NAMESPACE");
  await kv2.put("key", "value2");

  res = await mf1.dispatchFetch("http://placeholder");
  t.deepEqual(await res.json(), { version: 2, key: "value1" });
  res = await mf2.dispatchFetch("http://placeholder");
  t.deepEqual(await res.json(), { version: 3, key: "value2" });
});
test("persists on file-system", async (t) => {
  const tmp = await useTmp(t);
  const opts: MiniflareOptions = {
    modules: true,
    script: "",
    kvNamespaces: { NAMESPACE: "namespace" },
    kvPersist: tmp,
  };
  let mf = new Miniflare(opts);
  t.teardown(() => mf.dispose());

  let kv = await mf.getKVNamespace("NAMESPACE");
  await kv.put("key", "value");
  t.is(await kv.get("key"), "value");

  // Check directory created for namespace
  const names = await fs.readdir(tmp);
  t.true(names.includes("miniflare-KVNamespaceObject"));

  // Check "restarting" keeps persisted data
  await mf.dispose();
  mf = new Miniflare(opts);
  kv = await mf.getKVNamespace("NAMESPACE");
  t.is(await kv.get("key"), "value");
});

test("migrates database to new location", async (t) => {
  // Copy legacy data to temporary directory
  const tmp = await useTmp(t);
  const persistFixture = path.join(FIXTURES_PATH, "migrations", "3.20230821.0");
  const kvPersist = path.join(tmp, "kv");
  await fs.cp(path.join(persistFixture, "kv"), kvPersist, { recursive: true });

  // Implicitly migrate data
  const mf = new Miniflare({
    modules: true,
    script: "",
    kvNamespaces: ["NAMESPACE"],
    kvPersist,
  });
  t.teardown(() => mf.dispose());

  const namespace = await mf.getKVNamespace("NAMESPACE");
  t.is(await namespace.get("key"), "value");
});
