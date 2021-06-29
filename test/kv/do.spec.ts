import { AssertionError } from "assert";
import anyTest, { Macro, TestInterface } from "ava";
import {
  DurableObjectListOptions,
  DurableObjectStorage,
  DurableObjectTransaction,
  KVStorage,
  KVStoredValue,
  MemoryKVStorage,
} from "../../src";
import {
  abortAllSymbol,
  transactionReadSymbol,
  transactionValidateWriteSymbol,
} from "../../src/kv/do";
import { getObjectProperties, triggerPromise } from "../helpers";

interface Context {
  backing: KVStorage;
  storage: DurableObjectStorage;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const backing = new MemoryKVStorage();
  const storage = new DurableObjectStorage(backing);
  t.context = { backing, storage };
});

function storedValue(data: any): KVStoredValue {
  return { value: Buffer.from(JSON.stringify(data), "utf8") };
}

const testString = "value";
const testSet = new Set(["a", "b", "c"]);
const testDate = new Date(1000);
const testObject = { a: 1, b: 2, c: 3 };

const testStringStored = storedValue("value");
const testSetStored = storedValue({
  $: ["a", "b", "c"],
  $types: { $: { "": "set" } },
});
const testDateStored = storedValue({ $: 1000, $types: { $: { "": "date" } } });
const testObjectStored = storedValue({ a: 1, b: 2, c: 3 });

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
  for (const [key, value] of Object.entries(values)) {
    await backing.put(key, storedValue(value));
  }
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

function incrementTransaction(...keys: string[]) {
  return async (txn: DurableObjectTransaction) => {
    const values = await txn.get<number>(keys);
    const entries: Record<string, number> = {};
    for (const [key, value] of values.entries()) entries[key] = value + 1;
    await txn.put(entries);
  };
}

test("transaction: commits single transaction", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("a", storedValue(1));
  await backing.put("b", storedValue(2));
  await storage.transaction(incrementTransaction("a", "b"));
  t.deepEqual(await backing.get("a"), storedValue(2));
  t.deepEqual(await backing.get("b"), storedValue(3));
});
test("transaction: commits concurrent transactions operating on disjoint keys", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("a", storedValue(1));
  await backing.put("b", storedValue(2));
  const txnA = await storage[transactionReadSymbol](incrementTransaction("a"));
  const txnB = await storage[transactionReadSymbol](incrementTransaction("b"));
  t.true(await storage[transactionValidateWriteSymbol](txnA.txn));
  t.true(await storage[transactionValidateWriteSymbol](txnB.txn));
  t.deepEqual(await backing.get("a"), storedValue(2));
  t.deepEqual(await backing.get("b"), storedValue(3));
});
test("transaction: aborts concurrent transactions operating on conflicting keys", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("a", storedValue(1));
  await backing.put("b", storedValue(2));
  const txnA = await storage[transactionReadSymbol](incrementTransaction("a"));
  const txnB = await storage[transactionReadSymbol](
    incrementTransaction("a", "b")
  );
  t.true(await storage[transactionValidateWriteSymbol](txnA.txn));
  t.false(await storage[transactionValidateWriteSymbol](txnB.txn));
  t.deepEqual(await backing.get("a"), storedValue(2));
  t.deepEqual(await backing.get("b"), storedValue(2));
});
test("transaction: retries concurrent transactions operating on conflicting keys", async (t) => {
  // TODO: fix this test's scenario, currently each transaction is just run once
  const { backing, storage } = t.context;
  await backing.put("a", storedValue(1));
  await backing.put("b", storedValue(2));
  await Promise.all([
    await storage.transaction(incrementTransaction("a")),
    await storage.transaction(incrementTransaction("a", "b")),
  ]);
  t.deepEqual(await backing.get("a"), storedValue(3));
  t.deepEqual(await backing.get("b"), storedValue(3));
});
// TODO: test concurrent transactions using other operations (e.g. delete, deleteAll, list, etc)
test("transaction: rolledback transaction doesn't commit", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", storedValue("old"));
  await storage.transaction(async (txn) => {
    await txn.put("key", "new");
    txn.rollback();
  });
  t.deepEqual(await backing.get("key"), storedValue("old"));
});
test("transaction: cannot perform more operations after rollback", async (t) => {
  const { storage } = t.context;
  t.plan(6);
  await storage.transaction(async (txn) => {
    txn.rollback();
    await t.throwsAsync(txn.get("key"), { instanceOf: AssertionError });
    await t.throwsAsync(txn.put("key", "value"), {
      instanceOf: AssertionError,
    });
    await t.throwsAsync(txn.delete("key"), { instanceOf: AssertionError });
    await t.throwsAsync(txn.deleteAll(), { instanceOf: AssertionError });
    await t.throwsAsync(txn.list(), { instanceOf: AssertionError });
    await t.throws(() => txn.rollback(), { instanceOf: AssertionError });
  });
});
test("transaction: aborts all in-progress transactions", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", storedValue("old"));
  const [barrierTrigger, barrierPromise] = triggerPromise<void>();
  const txnPromise = storage.transaction(async (txn) => {
    await txn.put("key", "new");
    await barrierPromise;
  });

  // Abort all, then allow the transaction to complete
  storage[abortAllSymbol]();
  barrierTrigger();
  await txnPromise;

  t.deepEqual(await backing.get("key"), storedValue("old"));
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
