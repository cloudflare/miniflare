import { StorageOperator } from "@miniflare/shared";
import { FilteredKVNamespace } from "@miniflare/sites";
import { MemoryStorageOperator } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";
import { getObjectProperties, utf8Encode } from "test:@miniflare/shared";
import { testClock } from "test:@miniflare/storage-memory";

interface Context {
  storage: StorageOperator;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach(async (t) => {
  const storage = new MemoryStorageOperator(undefined, testClock);
  for (let i = 1; i <= 3; i++) {
    for (let j = 1; j <= 2; j++) {
      await storage.put(`section${i}key${j}`, {
        value: utf8Encode(`value${i}${j}`),
        expiration: 1000 + i * 100,
        metadata: { testing: i },
      });
    }
  }
  t.context = { storage };
});

test("get: includes included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    testClock
  );
  t.is(await ns.get("section1key1"), "value11");
  t.is(await ns.get("section1key2"), "value12");
  t.is(await ns.get("section2key1"), "value21");
  t.is(await ns.get("section2key2"), "value22");
});

test("get: excludes non-included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    testClock
  );
  t.is(await ns.get("section3key1"), null);
  t.is(await ns.get("section3key2"), null);
});

test("get: includes non-excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    testClock
  );
  t.is(await ns.get("section3key1"), "value31");
  t.is(await ns.get("section3key2"), "value32");
});

test("get: excludes excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    testClock
  );
  t.is(await ns.get("section1key1"), null);
  t.is(await ns.get("section1key2"), null);
  t.is(await ns.get("section2key1"), null);
  t.is(await ns.get("section2key2"), null);
});

test("get: ignores exclude if include set", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/, exclude: /^section1/ },
    testClock
  );
  t.is(await ns.get("section1key1"), "value11");
  t.is(await ns.get("section1key2"), "value12");
  t.is(await ns.get("section2key1"), "value21");
  t.is(await ns.get("section2key2"), "value22");
  t.is(await ns.get("section3key1"), null);
  t.is(await ns.get("section3key2"), null);
});

test("getWithMetadata: includes included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.getWithMetadata("section1key1"), {
    value: "value11",
    metadata: { testing: 1 },
  });
  t.deepEqual(await ns.getWithMetadata("section1key2"), {
    value: "value12",
    metadata: { testing: 1 },
  });
  t.deepEqual(await ns.getWithMetadata("section2key1"), {
    value: "value21",
    metadata: { testing: 2 },
  });
  t.deepEqual(await ns.getWithMetadata("section2key2"), {
    value: "value22",
    metadata: { testing: 2 },
  });
});

test("getWithMetadata: excludes non-included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.getWithMetadata("section3key1"), {
    value: null,
    metadata: null,
  });
  t.deepEqual(await ns.getWithMetadata("section3key2"), {
    value: null,
    metadata: null,
  });
});

test("getWithMetadata: includes non-excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.getWithMetadata("section3key1"), {
    value: "value31",
    metadata: { testing: 3 },
  });
  t.deepEqual(await ns.getWithMetadata("section3key2"), {
    value: "value32",
    metadata: { testing: 3 },
  });
});

test("getWithMetadata: excludes excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.getWithMetadata("section1key1"), {
    value: null,
    metadata: null,
  });
  t.deepEqual(await ns.getWithMetadata("section1key2"), {
    value: null,
    metadata: null,
  });
  t.deepEqual(await ns.getWithMetadata("section2key1"), {
    value: null,
    metadata: null,
  });
  t.deepEqual(await ns.getWithMetadata("section2key2"), {
    value: null,
    metadata: null,
  });
});

test("getWithMetadata: ignores exclude if include set", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/, exclude: /^section1/ },
    testClock
  );
  t.deepEqual(await ns.getWithMetadata("section1key1"), {
    value: "value11",
    metadata: { testing: 1 },
  });
  t.deepEqual(await ns.getWithMetadata("section1key2"), {
    value: "value12",
    metadata: { testing: 1 },
  });
  t.deepEqual(await ns.getWithMetadata("section2key1"), {
    value: "value21",
    metadata: { testing: 2 },
  });
  t.deepEqual(await ns.getWithMetadata("section2key2"), {
    value: "value22",
    metadata: { testing: 2 },
  });
  t.deepEqual(await ns.getWithMetadata("section3key1"), {
    value: null,
    metadata: null,
  });
  t.deepEqual(await ns.getWithMetadata("section3key2"), {
    value: null,
    metadata: null,
  });
});

test("put: allowed if not read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: false }, testClock);
  await ns.put("key", "value", {
    expiration: 1000,
    metadata: { testing: true },
  });
  t.deepEqual(await storage.get("key"), {
    value: utf8Encode("value"),
    expiration: 1000,
    metadata: { testing: true },
  });
});

test("put: throws if read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: true }, testClock);
  await t.throwsAsync(
    async () => {
      await ns.put("key", "value", {
        expiration: 1000,
        metadata: { testing: true },
      });
    },
    { instanceOf: TypeError, message: "Unable to put into read-only namespace" }
  );
  t.is(await storage.get("key"), undefined);
});

test("delete: allowed if not read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: false }, testClock);
  t.not(await storage.get("section1key1"), undefined);
  await ns.delete("section1key1");
  t.is(await storage.get("section1key1"), undefined);
});

test("delete: throws if read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: true }, testClock);
  t.not(await storage.get("section1key1"), undefined);
  await t.throwsAsync(async () => await ns.delete("section1key1"), {
    instanceOf: TypeError,
    message: "Unable to delete from read-only namespace",
  });
  t.not(await storage.get("section1key1"), undefined);
});

test("list: includes included values and excludes non-included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.list(), {
    keys: [
      { name: "section1key1", expiration: 1100, metadata: { testing: 1 } },
      { name: "section1key2", expiration: 1100, metadata: { testing: 1 } },
      { name: "section2key1", expiration: 1200, metadata: { testing: 2 } },
      { name: "section2key2", expiration: 1200, metadata: { testing: 2 } },
    ],
    list_complete: true,
    cursor: "",
  });
});

test("list: includes non-excluded values and excludes excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    testClock
  );
  t.deepEqual(await ns.list(), {
    keys: [
      { name: "section3key1", expiration: 1300, metadata: { testing: 3 } },
      { name: "section3key2", expiration: 1300, metadata: { testing: 3 } },
    ],
    list_complete: true,
    cursor: "",
  });
});

test("list: ignores exclude if include set", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/, exclude: /^section1/ },
    testClock
  );
  t.deepEqual(await ns.list(), {
    keys: [
      { name: "section1key1", expiration: 1100, metadata: { testing: 1 } },
      { name: "section1key2", expiration: 1100, metadata: { testing: 1 } },
      { name: "section2key1", expiration: 1200, metadata: { testing: 2 } },
      { name: "section2key2", expiration: 1200, metadata: { testing: 2 } },
    ],
    list_complete: true,
    cursor: "",
  });
});

test("hides implementation details", (t) => {
  const ns = new FilteredKVNamespace(t.context.storage);
  t.deepEqual(getObjectProperties(ns), [
    "delete",
    "get",
    "getWithMetadata",
    "list",
    "put",
  ]);
});
