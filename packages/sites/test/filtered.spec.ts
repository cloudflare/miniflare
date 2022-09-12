import { InternalKVNamespaceOptions } from "@miniflare/kv";
import { Storage } from "@miniflare/shared";
import {
  getObjectProperties,
  testClock,
  utf8Encode,
} from "@miniflare/shared-test";
import { FilteredKVNamespace, KeyMapper } from "@miniflare/sites";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";

interface Context {
  storage: Storage;
}

const test = anyTest as TestInterface<Context>;

const opts: InternalKVNamespaceOptions = { clock: testClock };

const keyMapper: KeyMapper = {
  lookup(key: string): string {
    return key.substring("prefix:".length);
  },
  reverseLookup(key: string): string {
    return `prefix:${key}`;
  },
};

test.beforeEach(async (t) => {
  const storage = new MemoryStorage(undefined, testClock);
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
    opts
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
    opts
  );
  t.is(await ns.get("section3key1"), null);
  t.is(await ns.get("section3key2"), null);
});
test("get: includes non-excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    opts
  );
  t.is(await ns.get("section3key1"), "value31");
  t.is(await ns.get("section3key2"), "value32");
});
test("get: excludes excluded values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { exclude: /^section1|^section2/ },
    opts
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
    opts
  );
  t.is(await ns.get("section1key1"), "value11");
  t.is(await ns.get("section1key2"), "value12");
  t.is(await ns.get("section2key1"), "value21");
  t.is(await ns.get("section2key2"), "value22");
  t.is(await ns.get("section3key1"), null);
  t.is(await ns.get("section3key2"), null);
});
test("get: respects mapper", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { map: keyMapper },
    opts
  );
  t.is(await ns.get("prefix:section1key1"), "value11");
});

test("getWithMetadata: includes included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    opts
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
    opts
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
    opts
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
    opts
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
    opts
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
test("getWithMetadata: respects mapper", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { map: keyMapper },
    opts
  );
  t.deepEqual(await ns.getWithMetadata("prefix:section1key1"), {
    value: "value11",
    metadata: { testing: 1 },
  });
});

test("put: allowed if not read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: false }, opts);
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
  const ns = new FilteredKVNamespace(storage, { readOnly: true }, opts);
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
test("put: respects mapper", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { map: keyMapper }, opts);
  await ns.put("prefix:key", "value");
  t.deepEqual(await storage.get("key"), {
    value: utf8Encode("value"),
    expiration: undefined,
    metadata: undefined,
  });
});

test("delete: allowed if not read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: false }, opts);
  t.not(await storage.get("section1key1"), undefined);
  await ns.delete("section1key1");
  t.is(await storage.get("section1key1"), undefined);
});
test("delete: throws if read-only", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { readOnly: true }, opts);
  t.not(await storage.get("section1key1"), undefined);
  await t.throwsAsync(async () => await ns.delete("section1key1"), {
    instanceOf: TypeError,
    message: "Unable to delete from read-only namespace",
  });
  t.not(await storage.get("section1key1"), undefined);
});
test("delete: respects mapper", async (t) => {
  const { storage } = t.context;
  const ns = new FilteredKVNamespace(storage, { map: keyMapper }, opts);
  t.not(await storage.get("section1key1"), undefined);
  await ns.delete("prefix:section1key1");
  t.is(await storage.get("section1key1"), undefined);
});

test("list: includes included values and excludes non-included values", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { include: /^section1|^section2/ },
    opts
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
    opts
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
    opts
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
test("list: respects mapper", async (t) => {
  const ns = new FilteredKVNamespace(
    t.context.storage,
    { map: keyMapper },
    opts
  );
  const keys = (await ns.list()).keys.map(({ name }) => name);
  t.deepEqual(keys, [
    "prefix:section1key1",
    "prefix:section1key2",
    "prefix:section2key1",
    "prefix:section2key2",
    "prefix:section3key1",
    "prefix:section3key2",
  ]);
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
