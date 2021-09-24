import { serialize } from "v8";
import {
  DurableObjectListOptions,
  DurableObjectStorage,
} from "@miniflare/durable-objects";
import { Storage, StoredValueMeta, viewToArray } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { Macro, TestInterface } from "ava";
import { getObjectProperties } from "test:@miniflare/shared";

interface Context {
  backing: Storage;
  storage: DurableObjectStorage;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const backing = new MemoryStorage();
  const storage = new DurableObjectStorage(backing);
  t.context = { backing, storage };
});

function storedValue(value: any): StoredValueMeta {
  return {
    value: viewToArray(serialize(value)),
    expiration: undefined,
    metadata: undefined,
  };
}

const testString = "value";
const testSet = new Set(["a", "b", "c"]);
const testDate = new Date(1000);
const testObject = { a: 1, b: 2, c: 3 };

const testStringStored = storedValue(testString);
const testSetStored = storedValue(testSet);
const testDateStored = storedValue(testDate);
const testObjectStored = storedValue(testObject);

test("get: gets single key", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", testStringStored);
  t.is(await storage.get("key"), testString);
});
test("get: gets single key with complex value", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", testSetStored);
  t.deepEqual(await storage.get("key"), testSet);
});
test("get: returns undefined for non-existent single key", async (t) => {
  const { storage } = t.context;
  t.is(await storage.get("key"), undefined);
});
test("get: gets multiple keys", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", storedValue("value1"));
  await backing.put("key2", storedValue("value2"));
  await backing.put("key3", storedValue("value3"));
  const expected = new Map([
    ["key1", "value1"],
    ["key2", "value2"],
    ["key3", "value3"],
  ]);
  t.deepEqual(await storage.get(["key1", "key2", "key3"]), expected);
});
test("get: gets multiple keys with complex values", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", testSetStored);
  await backing.put("key2", testDateStored);
  await backing.put("key3", testObjectStored);
  const expected = new Map<string, any>();
  expected.set("key1", testSet);
  expected.set("key2", testDate);
  expected.set("key3", testObject);
  t.deepEqual(await storage.get(["key1", "key2", "key3"]), expected);
});
test("get: returns map with non-existent keys omitted", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", storedValue("value1"));
  await backing.put("key3", storedValue("value3"));
  const expected = new Map([
    ["key1", "value1"],
    ["key3", "value3"],
  ]);
  t.deepEqual(await storage.get(["key1", "key2", "key3"]), expected);
});
test("get: gets uncommitted values", async (t) => {
  t.plan(5);
  const { backing, storage } = t.context;
  await backing.put("key1", storedValue("value1"));
  await backing.put("key2", storedValue("value2"));
  await storage.transaction(async (txn) => {
    // Test overwriting existing key
    await txn.put("key1", "new");
    t.is(await txn.get("key1"), "new");
    t.deepEqual(await backing.get("key1"), storedValue("value1"));

    // Test deleting key
    await txn.delete("key2");
    t.is(await txn.get("key2"), undefined);

    // Test creating new key
    await txn.put("key3", "value3");
    t.is(await txn.get("key3"), "value3");
    t.is(await backing.get("key3"), undefined);
  });
});
test("get: gets committed and uncommitted values in same transaction", async (t) => {
  t.plan(3);
  const { backing, storage } = t.context;
  await backing.put("key1", storedValue("value1"));
  await backing.put("key3", storedValue("value3"));
  await storage.transaction(async (txn) => {
    await txn.put("key2", "value2");
    await txn.delete("key3");
    const values = await txn.get(["key1", "key2", "key3"]);
    t.is(values.size, 2);
    t.is(values.get("key1"), "value1"); // committed
    t.is(values.get("key2"), "value2"); // uncommitted
  });
});

test("put: puts single key", async (t) => {
  const { backing, storage } = t.context;
  await storage.put("key", testString);
  t.deepEqual(await backing.get("key"), testStringStored);
});
test("put: puts single key with complex value", async (t) => {
  const { backing, storage } = t.context;
  await storage.put("key", testSet);
  t.deepEqual(await backing.get("key"), testSetStored);
});
test("put: puts multiple keys", async (t) => {
  const { backing, storage } = t.context;
  const entries = { key1: "value1", key2: "value2", key3: "value3" };
  await storage.put(entries);
  t.deepEqual(await backing.get("key1"), storedValue("value1"));
  t.deepEqual(await backing.get("key2"), storedValue("value2"));
  t.deepEqual(await backing.get("key3"), storedValue("value3"));
});
test("put: puts multiple keys with complex values", async (t) => {
  const { backing, storage } = t.context;
  const entries = { key1: testSet, key2: testDate, key3: testObject };
  await storage.put(entries);
  t.deepEqual(await backing.get("key1"), testSetStored);
  t.deepEqual(await backing.get("key2"), testDateStored);
  t.deepEqual(await backing.get("key3"), testObjectStored);
});
test("put: overrides existing keys", async (t) => {
  const { backing, storage } = t.context;
  await storage.put("key", "value1");
  await storage.put("key", "value2");
  t.deepEqual(await backing.get("key"), storedValue("value2"));
});

test("delete: deletes single key", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", testStringStored);
  t.not(await backing.get("key"), undefined);
  t.true(await storage.delete("key"));
  t.is(await backing.get("key"), undefined);
});
test("delete: returns false for non-existent single key", async (t) => {
  const { storage } = t.context;
  t.false(await storage.delete("key"));
});
test("delete: deletes multiple keys", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", testStringStored);
  await backing.put("key2", testStringStored);
  await backing.put("key3", testStringStored);
  t.not(await backing.get("key1"), undefined);
  t.not(await backing.get("key2"), undefined);
  t.not(await backing.get("key3"), undefined);
  t.is(await storage.delete(["key1", "key3"]), 2);
  t.is(await backing.get("key1"), undefined);
  t.not(await backing.get("key2"), undefined);
  t.is(await backing.get("key3"), undefined);
});
test("delete: omits non-existent keys from deleted count", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", testStringStored);
  t.is(await storage.delete(["key1", "key2", "key3"]), 1);
});

test("deleteAll: deletes all keys", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key1", testStringStored);
  await backing.put("key2", testStringStored);
  await backing.put("key3", testStringStored);
  t.not(await backing.get("key1"), undefined);
  t.not(await backing.get("key2"), undefined);
  t.not(await backing.get("key3"), undefined);
  await storage.deleteAll();
  t.is(await backing.get("key1"), undefined);
  t.is(await backing.get("key2"), undefined);
  t.is(await backing.get("key3"), undefined);
});

const listMacro: Macro<
  [expected: string[], options?: DurableObjectListOptions],
  Context
> = async (t, expected, options) => {
  const { backing, storage } = t.context;
  const values: Record<string, string> = {
    section1key1: "value11",
    section1key2: "value12",
    section2key1: "value21",
    section2key2: "value22",
    section3key1: "value31",
    section3key2: "value32",
  };
  await backing.putMany(
    Object.entries(values).map(([key, value]) => [key, storedValue(value)])
  );
  t.deepEqual(
    await storage.list(options),
    new Map(expected.map((key) => [key, values[key]]))
  );
};
listMacro.title = (providedTitle) => `list: ${providedTitle}`;

test("lists keys in sorted order", listMacro, [
  "section1key1",
  "section1key2",
  "section2key1",
  "section2key2",
  "section3key1",
  "section3key2",
]);
test(
  "lists keys starting from start inclusive",
  listMacro,
  ["section2key2", "section3key1", "section3key2"],
  { start: "section2key2" }
);
test(
  "lists keys ending at end exclusive",
  listMacro,
  ["section1key1", "section1key2"],
  { end: "section2key1" }
);
test(
  "lists keys in reverse order",
  listMacro,
  [
    "section3key2",
    "section3key1",
    "section2key2",
    "section2key1",
    "section1key2",
    "section1key1",
  ],
  { reverse: true }
);
test(
  "lists at most limit keys",
  listMacro,
  ["section1key1", "section1key2", "section2key1"],
  { limit: 3 }
);
test(
  "lists keys matching prefix",
  listMacro,
  ["section2key1", "section2key2"],
  { prefix: "section2" }
);
test(
  "lists keys with start, limit and prefix in reverse",
  listMacro,
  ["section3key2", "section3key1"],
  { start: "section2", prefix: "section", limit: 2, reverse: true }
);
test("returns empty list with start after all", listMacro, [], {
  start: "section4",
});
test("returns empty list with end before all", listMacro, [], {
  end: "section0",
});
test("returns empty list with start after end", listMacro, [], {
  start: "section3",
  end: "section1",
});
test("list: returns empty list with no keys", async (t) => {
  const { storage } = t.context;
  t.deepEqual(await storage.list(), new Map());
});

test("transaction: rolledback transaction doesn't commit", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", storedValue("old"));
  await storage.transaction(async (txn) => {
    await txn.put("key", "new");
    txn.rollback();
  });
  t.deepEqual(await backing.get("key"), storedValue("old"));
});
test("transaction: propagates return value", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("a", storedValue(1));
  const res = await storage.transaction(async (txn) => {
    const value = (await txn.get<number>("a")) ?? 0;
    return value + 2;
  });
  t.is(res, 3);
});

test("hides implementation details", (t) => {
  const { storage } = t.context;
  t.deepEqual(getObjectProperties(storage), [
    "delete",
    "deleteAll",
    "get",
    "list",
    "put",
    "transaction",
  ]);
});
test("transaction: hides implementation details", async (t) => {
  const { storage } = t.context;
  let properties: string[] = [];
  await storage.transaction(async (txn) => {
    properties = getObjectProperties(txn);
  });
  t.deepEqual(properties, [
    "delete",
    "deleteAll",
    "get",
    "list",
    "put",
    "rollback",
  ]);
});
