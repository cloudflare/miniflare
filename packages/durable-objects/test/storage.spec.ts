import assert from "assert";
import { setTimeout } from "timers/promises";
import { serialize } from "v8";
import {
  ALARM_KEY,
  AlarmStore,
  DurableObjectError,
  DurableObjectListOptions,
  DurableObjectStorage,
  DurableObjectTransaction,
} from "@miniflare/durable-objects";
import {
  InputGate,
  OutputGate,
  StoredValueMeta,
  nonCircularClone,
  viewToArray,
  waitForOpenInputGate,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  RecorderStorage,
  getObjectProperties,
  triggerPromise,
  utf8Encode,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, {
  ExecutionContext,
  Macro,
  TestInterface,
  ThrowsExpectation,
} from "ava";
import { alarmStore, testKey } from "./object";

interface Context {
  // We need synchronous access to storage for `sync()` tests, so require
  // in-memory storage.
  backing: MemoryStorage;
  storage: DurableObjectStorage;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const backing = new MemoryStorage();
  const alarmStore = new AlarmStore();
  alarmStore.setupStore(new MemoryStorageFactory());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
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
const testNumber = 1000;

const testStringStored = storedValue(testString);
const testSetStored = storedValue(testSet);
const testDateStored = storedValue(testDate);
const testObjectStored = storedValue(testObject);

const largeKey = "".padStart(2049, "x");
const largeSingleExpectation: ThrowsExpectation = {
  instanceOf: RangeError,
  message: "Keys cannot be larger than 2048 bytes.",
};
const largeManyExpectation: ThrowsExpectation = {
  instanceOf: RangeError,
  message: `Key "${largeKey}" is larger than the limit of 2048 bytes.`,
};
const tooManyKeys = Array.from(Array(129)).map((_, i) => i.toString());
const tooManyKeysExpectation: ThrowsExpectation = {
  instanceOf: RangeError,
  message: "Maximum number of keys is 128.",
};

async function closesInputGate<T>(
  t: ExecutionContext,
  closure: (allowConcurrency?: boolean) => Promise<T>
): Promise<void> {
  // InputGate is tested in gate.spec.ts, we just want to make sure the gate
  // is being closed here
  const inputGate = new InputGate();
  const originalRunWithClosed = inputGate.runWithClosed.bind(inputGate);
  let closed = false;
  inputGate.runWithClosed = (closure) => {
    closed = true;
    return originalRunWithClosed(closure);
  };

  // Check without allowConcurrency
  await inputGate.runWith(closure);
  t.true(closed);

  // Check with allowConcurrency
  closed = false;
  await inputGate.runWith(() => closure(true));
  t.false(closed);
}

async function closesOutputGate<T>(
  t: ExecutionContext,
  closure: (allowUnconfirmed?: boolean) => Promise<T>
): Promise<void> {
  // OutputGate is tested in gate.spec.ts, we just want to make sure the gate
  // is being closed here
  const outputGate = new OutputGate();
  const originalWaitUntil = outputGate.waitUntil.bind(outputGate);
  let closed = false;
  outputGate.waitUntil = (promise) => {
    closed = true;
    return originalWaitUntil(promise);
  };

  // Check without allowUnconfirmed
  await outputGate.runWith(closure);
  t.true(closed);

  // Check with allowUnconfirmed
  closed = false;
  await outputGate.runWith(() => closure(true));
  t.false(closed);
}

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
  // Results should be always be returned in lexicographic order:
  // https://github.com/cloudflare/miniflare/issues/393
  const expected = new Map([
    ["key1", "value1"],
    ["key2", "value2"],
    ["key3", "value3"],
  ]);
  t.deepEqual(await storage.get(["key2", "key3", "key1"]), expected);
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
test("get: throws with helpful error when deserialization fails", async (t) => {
  const { backing, storage } = t.context;
  await backing.put("key", { value: utf8Encode("bad") });
  const expectations: ThrowsExpectation = {
    instanceOf: DurableObjectError,
    code: "ERR_DESERIALIZATION",
    message:
      "Unable to deserialize stored Durable Object data due to an invalid or unsupported version.\n" +
      "The Durable Object data storage format changed in Miniflare 2. You cannot load Durable Object data created with Miniflare 1 and must delete it.",
  };
  await t.throwsAsync(storage.get("key"), expectations);
  await t.throwsAsync(storage.get(["key"]), expectations);
});
test("transaction: get: gets uncommitted values", async (t) => {
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
test("transaction: get: gets committed and uncommitted values in same transaction", async (t) => {
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
test("get: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.get("key", { allowConcurrency })
  );
  await storage.transaction(async (txn) => {
    await closesInputGate(t, (allowConcurrency) =>
      txn.get("key", { allowConcurrency })
    );
  });
});
test("get: blocks writes until complete", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: 1, key2: 2, key3: 3 });
  const promise = storage.get("key2");
  await storage.put("key2", 4);
  t.is(await promise, 2);
});
test("get: validates keys", async (t) => {
  const { storage } = t.context;

  // @ts-expect-error intentionally testing not passing correct types
  await t.throwsAsync(storage.get(), {
    instanceOf: TypeError,
    message: /'get' on 'DurableObjectStorage': .* \(key is undefined\)/,
  });
  await t.throwsAsync(storage.get(largeKey), largeSingleExpectation);
  await t.throwsAsync(storage.get(["a", largeKey, "b"]), largeManyExpectation);
  await t.throwsAsync(storage.get(tooManyKeys), tooManyKeysExpectation);

  await t.throwsAsync(
    // @ts-expect-error intentionally testing not passing correct types
    storage.transaction((txn) => txn.get()),
    {
      instanceOf: TypeError,
      message: /'get' on 'DurableObjectTransaction': .* \(key is undefined\)/,
    }
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.get(largeKey)),
    largeSingleExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.get(["a", largeKey, "b"])),
    largeManyExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.get(tooManyKeys)),
    tooManyKeysExpectation
  );
});
test("get: getting multiple keys ignores undefined keys", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  // @ts-expect-error intentionally testing not passing correct types
  await storage.get(["a", undefined, "b"]);
  t.deepEqual(backing.events, [{ type: "getMany", keys: ["a", "b"] }]);

  backing.events = [];
  // @ts-expect-error intentionally testing not passing correct types
  await storage.transaction((txn) => txn.get(["a", undefined, "b"]));
  t.deepEqual(backing.events, [{ type: "getMany", keys: ["a", "b"] }]);
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
test("put: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.put("key", "value", { allowConcurrency })
  );
  await closesInputGate(t, (allowConcurrency) =>
    storage.put({ key: "value" }, { allowConcurrency })
  );
  await storage.transaction(async (txn) => {
    await closesInputGate(t, (allowConcurrency) =>
      txn.put("key", "value", { allowConcurrency })
    );
  });
  await storage.transaction(async (txn) => {
    await closesInputGate(t, (allowConcurrency) =>
      txn.put({ key: "value" }, { allowConcurrency })
    );
  });
});
test("put: closes output gate unless allowUnconfirmed", async (t) => {
  const { storage } = t.context;
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.put("key", "value", { allowUnconfirmed })
  );
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.put({ key: "value" }, { allowUnconfirmed })
  );
  await storage.transaction(async (txn) => {
    await closesOutputGate(t, (allowUnconfirmed) =>
      txn.put("key", "value", { allowUnconfirmed })
    );
  });
  await storage.transaction(async (txn) => {
    await closesOutputGate(t, (allowUnconfirmed) =>
      txn.put({ key: "value" }, { allowUnconfirmed })
    );
  });
});
test("put: validates keys", async (t) => {
  const { storage } = t.context;
  const entries = Object.fromEntries(
    Array.from(Array(129)).map((_, i) => [i.toString(), i])
  );
  const countExpectation: ThrowsExpectation = {
    instanceOf: RangeError,
    message: "Maximum number of pairs is 128.",
  };

  // Note we're checking put throws synchronously
  // @ts-expect-error intentionally testing not passing correct types
  t.throws(() => storage.put(), {
    instanceOf: TypeError,
    message: /'put' on 'DurableObjectStorage': .* \(key is undefined\)/,
  });
  t.throws(() => storage.put(largeKey, 1), largeSingleExpectation);
  t.throws(
    () => storage.put({ a: 1, [largeKey]: 2, b: 3 }),
    largeManyExpectation
  );
  t.throws(() => storage.put(entries), countExpectation);

  await t.throwsAsync(
    // @ts-expect-error intentionally testing not passing correct types
    storage.transaction((txn) => txn.put()),
    {
      instanceOf: TypeError,
      message: /'put' on 'DurableObjectTransaction': .* \(key is undefined\)/,
    }
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.put(largeKey, 1)),
    largeSingleExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.put({ a: 1, [largeKey]: 2, b: 3 })),
    largeManyExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.put(entries)),
    countExpectation
  );
});
test("put: validates values", async (t) => {
  const { storage } = t.context;
  const undefinedExpectation: ThrowsExpectation = {
    instanceOf: TypeError,
    message: "put() called with undefined value.",
  };
  const largeValueSingleExpectation: ThrowsExpectation = {
    instanceOf: RangeError,
    message: "Values cannot be larger than 131072 bytes.",
  };
  const largeValueManyExpectation: ThrowsExpectation = {
    instanceOf: RangeError,
    message: 'Value for key "large" is above the limit of 131072 bytes.',
  };

  const maxValue = new Uint8Array(128 * 1024); // This should be storable
  const largeValue = new Uint8Array(128 * 1024 + 32);

  // Note we're checking put throws synchronously
  t.throws(() => storage.put("key", undefined), undefinedExpectation);
  await storage.put("key", maxValue);
  t.throws(() => storage.put("key", largeValue), largeValueSingleExpectation);
  t.throws(
    () => storage.put({ a: 1, large: largeValue, b: 2 }),
    largeValueManyExpectation
  );

  await t.throwsAsync(
    storage.transaction((txn) => txn.put("key", undefined)),
    undefinedExpectation
  );
  await storage.transaction((txn) => txn.put("key", maxValue));
  await t.throwsAsync(
    storage.transaction((txn) => txn.put("key", largeValue)),
    largeValueSingleExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.put({ a: 1, large: largeValue, b: 2 })),
    largeValueManyExpectation
  );
});
test("put: putting multiple values ignores undefined values", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  await storage.put({ a: 1, b: undefined, c: 2 });
  t.deepEqual(backing.events, [{ type: "putMany", keys: ["a", "c"] }]);

  backing.events = [];
  await storage.transaction((txn) => txn.put({ a: 1, b: undefined, c: 2 }));
  t.deepEqual(backing.events, [{ type: "putMany", keys: ["a", "c"] }]);
});
test("put: coalesces writes", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  const outputGate = new OutputGate();
  await outputGate.runWith(() => {
    storage.put("key", 1);
    storage.put("key2", 2);
    storage.put("key", 3);
    storage.put("key", 4);
  });
  t.deepEqual(backing.events, [{ type: "putMany", keys: ["key", "key2"] }]);
  t.is(await storage.get("key"), 4);
  t.is(await storage.get("key2"), 2);
});
test("put: marks keys as written, retrying conflicting transactions", async (t) => {
  const { storage } = t.context;
  await storage.put("key", 1);
  const [startTrigger, startPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  // This transaction should be retried
  let retries = 0;
  const txnPromise = storage.transaction(async (txn) => {
    retries++;
    startTrigger();
    await finishPromise;
    return txn.get("key");
  });
  await startPromise;
  await storage.put("key", 2);
  finishTrigger();
  t.is(await txnPromise, 2);
  t.is(retries, 2);
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
test("delete: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.delete("key", { allowConcurrency })
  );
});
test("delete: closes output gate unless allowConfirmed", async (t) => {
  const { storage } = t.context;
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.delete("key", { allowUnconfirmed })
  );
});
test("delete: validates keys", async (t) => {
  const { storage } = t.context;

  // Note we're checking delete throws synchronously
  // @ts-expect-error intentionally testing not passing correct types
  t.throws(() => storage.delete(), {
    instanceOf: TypeError,
    message: /'delete' on 'DurableObjectStorage': .* \(key is undefined\)/,
  });
  t.throws(() => storage.delete(largeKey), largeSingleExpectation);
  t.throws(() => storage.delete(["a", largeKey, "b"]), largeManyExpectation);
  t.throws(() => storage.delete(tooManyKeys), tooManyKeysExpectation);

  await t.throwsAsync(
    // @ts-expect-error intentionally testing not passing correct types
    storage.transaction((txn) => txn.delete()),
    {
      instanceOf: TypeError,
      message:
        /'delete' on 'DurableObjectTransaction': .* \(key is undefined\)/,
    }
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.delete(largeKey)),
    largeSingleExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.delete(["a", largeKey, "b"])),
    largeManyExpectation
  );
  await t.throwsAsync(
    storage.transaction((txn) => txn.delete(tooManyKeys)),
    tooManyKeysExpectation
  );
});
test("delete: delete multiple keys ignores undefined keys", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  // @ts-expect-error intentionally testing not passing correct types
  await storage.delete(["a", undefined, "b"]);
  t.deepEqual(backing.events, [{ type: "deleteMany", keys: ["a", "b"] }]);

  backing.events = [];
  // @ts-expect-error intentionally testing not passing correct types
  await storage.transaction((txn) => txn.delete(["a", undefined, "b"]));
  t.deepEqual(backing.events, [
    { type: "hasMany", keys: ["a", "b"] },
    { type: "deleteMany", keys: ["a", "b"] },
  ]);
});
test("delete: reports key deleted with put if storage includes key", async (t) => {
  const { storage } = t.context;
  await storage.put("key", 1);
  const promise = storage.delete("key");
  // noinspection ES6MissingAwait
  void storage.put("key", 2);
  t.true(await promise);
});
test("delete: reports key not deleted with put if storage doesn't include key", async (t) => {
  const { storage } = t.context;
  const promise = storage.delete("key");
  // noinspection ES6MissingAwait
  void storage.put("key", 2);
  t.false(await promise);
});
test("delete: reports key deleted if included in shadow copy", async (t) => {
  const { storage } = t.context;
  // noinspection ES6MissingAwait
  void storage.put("key", 1);
  t.true(await storage.delete("key"));
});
test("delete: reports key not deleted if already deleted in shadow copy", async (t) => {
  const { storage } = t.context;
  await storage.put("key", 1);
  // noinspection ES6MissingAwait
  void storage.delete("key");
  t.false(await storage.delete("key"));
});
test("delete: coalesces deletes", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  await storage.put("key6", 6);
  backing.events = [];
  const outputGate = new OutputGate();
  let promiseMany: Promise<number> | undefined;
  let promiseSingle: Promise<boolean> | undefined;
  await outputGate.runWith(() => {
    storage.put("key1", 1);
    storage.put("key2", 2);
    storage.put("key3", 3);
    promiseMany = storage.delete(["key1", "key2", "key4", "key6"]);
    promiseSingle = storage.delete("key5");
    storage.put("key4", 4);
    storage.put("key5", 5);
    storage.put("key1", 10);
  });
  t.deepEqual(backing.events, [
    // key4 and key5 get deleted on their own as we're not sure if they exist
    { type: "deleteMany", keys: ["key4", "key6"] },
    { type: "deleteMany", keys: ["key5"] },
    // puts get coalesced
    { type: "putMany", keys: ["key1", "key3", "key4", "key5"] },
    // key2 gets deleted on it's own as we don't need to know if it exists,
    // since we already know the result as it was previously written
    { type: "deleteMany", keys: ["key2"] },
  ]);
  t.deepEqual(
    await storage.get(["key1", "key2", "key3", "key4", "key5"]),
    new Map([
      ["key1", 10],
      ["key3", 3],
      ["key4", 4],
      ["key5", 5],
    ])
  );
  // 2 from shadow copies (key1, key2) + 1 already existing (key6)
  t.is(await promiseMany, 3);
  t.is(await promiseSingle, false);
});
test("delete: marks keys as written, retrying conflicting transactions", async (t) => {
  const { storage } = t.context;
  await storage.put("key", 1);
  const [startTrigger, startPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  // This transaction should be retried
  let retries = 0;
  const txnPromise = storage.transaction(async (txn) => {
    retries++;
    startTrigger();
    await finishPromise;
    return txn.get("key");
  });
  await startPromise;
  await storage.delete("key");
  finishTrigger();
  t.is(await txnPromise, undefined);
  t.is(retries, 2);
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
test("deleteAll: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.deleteAll({ allowConcurrency })
  );
});
test("deleteAll: closes output gate unless allowConfirmed", async (t) => {
  const { storage } = t.context;
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.deleteAll({ allowUnconfirmed })
  );
});
test("deleteAll: coalesces with previous puts", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  await storage.put({ a: 1, b: 2 });

  backing.events = [];
  // noinspection ES6MissingAwait
  void storage.put({ c: 3 });
  await storage.deleteAll();

  // Note there's no `put(c)` event
  t.is(backing.events.length, 2);
  t.is(backing.events[0].type, "list");
  t.is(backing.events[1].type, "deleteMany");
  assert(backing.events[1].type === "deleteMany");
  t.deepEqual(backing.events[1].keys.sort(), ["a", "b", "c"]); // Order irrelevant
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
  "lists keys starting from startAfter exclusive",
  listMacro,
  ["section3key1", "section3key2"],
  { startAfter: "section2key2" }
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
test(
  "lists keys with startAfter and limit (where startAfter matches key)",
  listMacro,
  ["section2key2", "section3key1"],
  { startAfter: "section2key1", limit: 2 }
);
test(
  "lists keys with startAfter and limit (where startAfter doesn't match key)",
  listMacro,
  ["section2key1", "section2key2"],
  { startAfter: "section2", limit: 2 }
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
test("list: cannot set start and startAfter simultaneously", async (t) => {
  const { storage } = t.context;
  await t.throwsAsync(storage.list({ start: "a", startAfter: "b" }), {
    instanceOf: TypeError,
    message: "list() cannot be called with both start and startAfter values.",
  });
});
test("list: doesn't mutate list options when startAfter set", async (t) => {
  const { storage } = t.context;
  const options = { startAfter: "a" };
  const original = nonCircularClone(options);
  await storage.list(options);
  t.deepEqual(options, original);
});
test("list: returns empty list with no keys", async (t) => {
  const { storage } = t.context;
  t.deepEqual(await storage.list(), new Map());
});
test("list: can list more than 128 keys", async (t) => {
  // Put 384 keys
  const { storage } = t.context;
  for (let group = 0; group < 3; group++) {
    const entries: Record<string, number> = {};
    for (let key = 0; key < 128; key++) {
      const i = group * 128 + key;
      entries[`key${i}`] = i;
    }
    await storage.put(entries);
  }

  // Check can list them all
  const result = await storage.list();
  t.is(result.size, 384);
  for (let i = 0; i < 384; i++) t.is(result.get(`key${i}`), i);
});
test("list: sorts lexicographically", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/235
  const { storage } = t.context;
  await storage.put({ "!": {}, ", ": {} });
  let keys = Array.from((await storage.list()).keys());
  t.deepEqual(keys, ["!", ", "]);

  // https://github.com/cloudflare/miniflare/issues/380
  await storage.deleteAll();
  await storage.put({ Z: 0, "\u{1D655}": 1, "\uFF3A": 2 });
  keys = Array.from((await storage.list()).keys());
  t.deepEqual(keys, ["Z", "\uFF3A", "\u{1D655}"]);
});
test("list: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.list({ allowConcurrency })
  );
});
test("list: blocks writes until complete", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: 1, key2: 2, key3: 3 });
  const promise = storage.list();
  await storage.put("key2", 4);
  t.deepEqual(
    await promise,
    new Map([
      ["key1", 1],
      ["key2", 2],
      ["key3", 3],
    ])
  );
});

test("getAlarm: storage returns inputed number", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(testNumber);
  t.is(await storage.getAlarm(), testNumber);
});
test("getAlarm: backing returns inputed number", async (t) => {
  const { backing } = t.context;
  await backing.put(ALARM_KEY, storedValue(testNumber));
  t.deepEqual(await backing.get(ALARM_KEY), storedValue(testNumber));
});
test("transaction: getAlarm: gets uncommitted values", async (t) => {
  t.plan(6);
  const { backing, storage } = t.context;
  await backing.put(ALARM_KEY, storedValue(1));
  await storage.transaction(async (txn) => {
    // Test overwriting existing alarm
    await txn.setAlarm(2);
    t.is(await txn.getAlarm(), 2);
    t.deepEqual(await backing.get(ALARM_KEY), storedValue(1));

    // Test deleting alarm
    await txn.deleteAlarm();
    t.is(await txn.getAlarm(), null);
    t.deepEqual(await backing.get(ALARM_KEY), storedValue(1));

    // Test creating new alarm
    await txn.setAlarm(3);
    t.is(await txn.getAlarm(), 3);
    t.deepEqual(await backing.get(ALARM_KEY), storedValue(1));
  });
});
test("transaction: getAlarm: gets committed and uncommitted values in same transaction", async (t) => {
  t.plan(3);
  const { backing, storage } = t.context;
  await backing.put(ALARM_KEY, storedValue(1));
  await backing.put(ALARM_KEY, storedValue(3));
  await storage.transaction(async (txn) => {
    t.is(await txn.getAlarm(), null);
    await txn.setAlarm(2);
    t.is(await txn.getAlarm(), 2);
    t.deepEqual(await backing.get(ALARM_KEY), storedValue(3));
  });
});
test("transaction: getAlarm: respect transactional updates", async (t) => {
  t.plan(2);
  const { backing, storage } = t.context;
  await backing.put(ALARM_KEY, storedValue(1));
  await storage.setAlarm(2);
  await storage.transaction(async (txn) => {
    const time = Date.now() + 30_000;
    await txn.setAlarm(time);
    await txn.getAlarm();
    t.is(await txn.getAlarm(), time);
    await txn.deleteAlarm();
    t.is(await txn.getAlarm(), null);
  });
});
test("getAlarm: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.getAlarm({ allowConcurrency })
  );
  await storage.transaction(async (txn) => {
    await closesInputGate(t, (allowConcurrency) =>
      txn.getAlarm({ allowConcurrency })
    );
  });
});
test("getAlarm: blocks writes until complete", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(1);
  const promise = storage.getAlarm();
  await storage.setAlarm(2);
  t.is(await promise, 1);
});

test("setAlarm: storage returns inputed number", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(testNumber);
  t.is(await storage.getAlarm(), testNumber);
});
test("setAlarm: storage as date returns inputed number", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(testDate);
  t.is(await storage.getAlarm(), testNumber);
});
test("setAlarm: backing returns inputed number", async (t) => {
  const { backing } = t.context;
  await backing.put(ALARM_KEY, storedValue(testNumber));
  t.deepEqual(await backing.get(ALARM_KEY), storedValue(testNumber));
});
test("setAlarm: overide alarm", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(testNumber);
  await storage.setAlarm(5);
  t.is(await storage.getAlarm(), 5);
});
test("setAlarm: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.setAlarm(testNumber, { allowConcurrency })
  );
  await storage.transaction(async (txn) => {
    await closesInputGate(t, (allowConcurrency) =>
      txn.setAlarm(testNumber, { allowConcurrency })
    );
  });
});
test("setAlarm: closes output gate unless allowUnconfirmed", async (t) => {
  const { storage } = t.context;
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.setAlarm(testNumber, { allowUnconfirmed })
  );
  await storage.transaction(async (txn) => {
    await closesOutputGate(t, (allowUnconfirmed) =>
      txn.setAlarm(testNumber, { allowUnconfirmed })
    );
  });
});
test("setAlarm: coalesces writes", async (t) => {
  t.plan(2);
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  const outputGate = new OutputGate();
  await outputGate.runWith(() => {
    storage.setAlarm(1);
    storage.setAlarm(2);
  });
  t.deepEqual(backing.events, [{ type: "put", key: ALARM_KEY }]);
  t.is(await storage.getAlarm(), 2);
});

test("setAlarm: marks alarm as written, retrying conflicting transactions", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(1);
  const [startTrigger, startPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  // This transaction should be retried
  let retries = 0;
  const txnPromise = storage.transaction(async (txn) => {
    retries++;
    startTrigger();
    await finishPromise;
    return txn.getAlarm();
  });
  await startPromise;
  await storage.setAlarm(2);
  finishTrigger();
  // the transaction should clear the alarm from shadow storage
  t.is(await txnPromise, 2);
  t.is(retries, 2);
});

test("deleteAlarm: deletes active alarm", async (t) => {
  const { backing, storage } = t.context;
  await backing.put(ALARM_KEY, storedValue(testNumber));
  t.not(await backing.get(ALARM_KEY), null);
  t.is(await storage.deleteAlarm(), undefined);
  t.is(await backing.get(ALARM_KEY), undefined);
});
test("deleteAlarm: removing from storage works", async (t) => {
  t.plan(2);
  const { backing, storage } = t.context;
  await backing.put(ALARM_KEY, storedValue(testNumber));
  await storage.deleteAlarm();
  t.is(await backing.get(ALARM_KEY), undefined);
  t.is(await storage.getAlarm(), null);
});
test("deleteAlarm: closes input gate unless allowConcurrency", async (t) => {
  const { storage } = t.context;
  await closesInputGate(t, (allowConcurrency) =>
    storage.deleteAlarm({ allowConcurrency })
  );
});
test("deleteAlarm: closes output gate unless allowConfirmed", async (t) => {
  const { storage } = t.context;
  await closesOutputGate(t, (allowUnconfirmed) =>
    storage.deleteAlarm({ allowUnconfirmed })
  );
});
test("deleteAlarm: reports proper ordering (gates work)", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(1);
  const promise = storage.deleteAlarm();
  // noinspection ES6MissingAwait
  void storage.setAlarm(2);
  t.is(await storage.getAlarm(), 2);
  await promise;
});
test("deleteAlarm: coalesces delete", async (t) => {
  const backing = new RecorderStorage(new MemoryStorage());
  const storage = new DurableObjectStorage(
    backing,
    alarmStore.buildBridge(testKey)
  );
  await storage.setAlarm(6);
  backing.events = [];
  const outputGate = new OutputGate();
  let promiseSingle: Promise<void> | undefined;
  await outputGate.runWith(async () => {
    await storage.setAlarm(1);
    promiseSingle = storage.deleteAlarm();
    await storage.setAlarm(2);
  });
  t.deepEqual(backing.events, [
    { key: ALARM_KEY, type: "put" },
    { key: ALARM_KEY, type: "put" },
  ]);
  t.is(await storage.getAlarm(), 2);
  await promiseSingle;
});
test("deleteAlarm: marks keys as written, retrying conflicting transactions", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(testNumber);
  const [startTrigger, startPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  // This transaction should be retried
  let retries = 0;
  const txnPromise = storage.transaction(async (txn) => {
    retries++;
    startTrigger();
    await finishPromise;
    return txn.getAlarm();
  });
  await startPromise;
  await storage.deleteAlarm();
  finishTrigger();
  t.is(await txnPromise, null);
  t.is(retries, 2);
});

test("transaction: checks if committed and uncommitted values exist in same transaction", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: "value1", key2: "value2" });
  await storage.transaction(async (txn) => {
    // Test overriding existing key
    await txn.put("key1", "value1");
    t.truthy(await txn.get("key1"));

    // Test deleting existing key
    await txn.delete("key2");
    t.falsy(await txn.get("key2"));

    // Test adding new key
    await txn.put("key3", "value3");
    t.truthy(await txn.get("key3"));
  });
});
test("transaction: alarm: checks if committed and uncommitted values exist in same transaction", async (t) => {
  const { storage } = t.context;
  await storage.setAlarm(1);
  await storage.transaction(async (txn) => {
    // Test overriding existing key
    await txn.setAlarm(2);
    t.is(await txn.getAlarm(), 2);

    // Test deleting existing key
    await txn.deleteAlarm();
    t.is(await txn.getAlarm(), null);
  });
});
test("transaction: gets uncommitted values", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: "value1", key2: "value2" });
  await storage.transaction(async (txn) => {
    // Test overwriting existing key
    await txn.put("key1", "new");
    t.is(await txn.get("key1"), "new");
    t.is(await storage.get("key1"), "value1");

    // Test deleting key
    await txn.delete("key2");
    t.is(await txn.get("key2"), undefined);
    t.not(await storage.get("key2"), undefined);

    // Test creating new key
    await txn.put("key3", "value3");
    t.is(await txn.get("key3"), "value3");
    t.is(await storage.get("key3"), undefined);
  });
});
test("transaction: gets committed and uncommitted values in same transaction", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: "value1", key3: "value3" });
  await storage.transaction(async (txn) => {
    await txn.put("key2", "value2");
    await txn.delete("key3");
    const values = await txn.get(["key1", "key2", "key3"]);
    t.is(values.size, 2);
    t.is(values.get("key1"), "value1"); // committed
    t.is(values.get("key2"), "value2"); // uncommitted
    t.is(values.get("key3"), undefined);
  });
});
test("transaction: reports key added during transaction deleted", async (t) => {
  const { storage } = t.context;
  await storage.transaction(async (txn) => {
    await txn.put("key", "value");
    t.true(await txn.delete("key"));
  });
  t.is(await storage.get("key"), undefined);
});
test("transaction: includes key added during transaction in list", async (t) => {
  const { storage } = t.context;
  await storage.put({ key1: "value1", key3: "value3" });
  await storage.transaction(async (txn) => {
    await txn.put("key2", "value2");
    const result = await txn.list();
    t.deepEqual([...result.keys()], ["key1", "key2", "key3"]);
  });
});

function incrementTransaction(...keys: string[]) {
  return async (txn: DurableObjectTransaction) => {
    const values = await txn.get<number>(keys);
    const newValues: { [key: string]: number } = {};
    for (const key of keys) newValues[key] = (values.get(key) ?? 0) + 1;
    // Allow other transactions to start running (we want conflicts)
    await setTimeout();
    await txn.put(newValues);
  };
}
test("transaction: commits single transaction", async (t) => {
  const { storage } = t.context;
  await storage.put({ a: 1, b: 2 });
  const txn = incrementTransaction("a", "b");
  await storage.transaction(txn);
  const results = await storage.get(["a", "b"]);
  t.is(results.get("a"), 2);
  t.is(results.get("b"), 3);
});
test("transaction: commits concurrent transactions operating on disjoint keys", async (t) => {
  const { storage } = t.context;
  await storage.put({ a: 1, b: 2 });
  const txnA = incrementTransaction("a");
  const txnB = incrementTransaction("b");
  await Promise.all([storage.transaction(txnA), storage.transaction(txnB)]);
  const results = await storage.get(["a", "b"]);
  t.is(results.get("a"), 2);
  t.is(results.get("b"), 3);
});
test("transaction: retries concurrent transactions operating on conflicting keys", async (t) => {
  const { storage } = t.context;
  await storage.put({ a: 1, b: 2 });
  const txnA = incrementTransaction("a");
  const txnB = incrementTransaction("a", "b");
  await Promise.all([storage.transaction(txnA), storage.transaction(txnB)]);
  const results = await storage.get(["a", "b"]);
  t.is(results.get("a"), 3);
  t.is(results.get("b"), 3);
});
test("transaction: retries concurrent transactions operating on single key", async (t) => {
  const { storage } = t.context;
  await storage.put("a", 1);
  const txn = incrementTransaction("a");
  await Promise.all(Array.from(Array(10)).map(() => storage.transaction(txn)));
  t.is(await storage.get("a"), 11);
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
test("transaction: allows delivery of events inside transaction closure even though outer input gate closed", async (t) => {
  // Testing nested input gates
  const { storage } = t.context;
  async function fetch() {
    await setTimeout();
    await waitForOpenInputGate();
    return "body";
  }
  const inputGate = new InputGate();
  await inputGate.runWith(async () => {
    await storage.transaction(async (txn) => {
      const body = await fetch();
      await txn.put("result", body);
    });
  });
  t.is(await storage.get("result"), "body");
});
test("transaction: waits for un-awaited writes before committing", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/250
  const { storage } = t.context;
  await storage.transaction((txn) => {
    void txn.put("key", "value");
    return Promise.resolve();
  });
  t.is(await storage.get("key"), "value");
});
test("transaction: performs operations in program order", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/344
  const { storage } = t.context;
  await storage.transaction((txn) => {
    void txn.delete("key");
    void txn.put("key", "value");
    return Promise.resolve();
  });
  t.is(await storage.get("key"), "value"); // not `undefined`
});

test("sync: waits for writes to be synchronised with storage", async (t) => {
  const { backing, storage } = t.context;

  // Check `sync()` waits for `put()`s
  // noinspection ES6MissingAwait
  void storage.put("key1", "value1");
  let syncPromise: Promise<void> | undefined = storage.sync();
  // `syncPromise` shouldn't resolve until all pending flushes have completed,
  // including those performed with `allowUnconfirmed`
  // noinspection ES6MissingAwait
  void storage.put("key2", "value2", { allowUnconfirmed: true });

  // Note `getMaybeExpired()` is synchronous in `MemoryStorage`
  t.is(backing.getMaybeExpired("key1"), undefined);
  t.is(backing.getMaybeExpired("key2"), undefined);
  await syncPromise;
  t.not(backing.getMaybeExpired("key1"), undefined);
  t.not(backing.getMaybeExpired("key2"), undefined);

  // Check `sync()` waits for `delete()`s
  // noinspection ES6MissingAwait
  void storage.delete("key1");
  // noinspection ES6MissingAwait
  void storage.delete("key2", { allowUnconfirmed: true });
  t.not(backing.getMaybeExpired("key1"), undefined);
  t.not(backing.getMaybeExpired("key2"), undefined);
  await storage.sync();
  t.is(backing.getMaybeExpired("key1"), undefined);
  t.is(backing.getMaybeExpired("key2"), undefined);

  // Check `sync()` waits for `deleteAll()`s
  await storage.put("key1", "value1");
  // noinspection ES6MissingAwait
  void storage.deleteAll();
  t.not(backing.getMaybeExpired("key1"), undefined);
  await storage.sync();
  t.is(backing.getMaybeExpired("key1"), undefined);

  // Check `sync()` waits for `setAlarm()`s
  // noinspection ES6MissingAwait
  void storage.setAlarm(Date.now() + 60_000);
  t.is(backing.getMaybeExpired("__MINIFLARE_ALARMS__"), undefined);
  await storage.sync();
  t.not(backing.getMaybeExpired("__MINIFLARE_ALARMS__"), undefined);

  // Check `sync()` waits for `deleteAlarm()`s
  // noinspection ES6MissingAwait
  void storage.deleteAlarm();
  t.not(backing.getMaybeExpired("__MINIFLARE_ALARMS__"), undefined);
  await storage.sync();
  t.is(backing.getMaybeExpired("__MINIFLARE_ALARMS__"), undefined);

  // Check `sync()` waits for `transaction()`s
  syncPromise = undefined;
  // noinspection ES6MissingAwait
  void storage.transaction(async (txn) => {
    // Check calling `sync()` while transaction running waits for transaction
    // to complete. Note this closure may be called multiple times, but we only
    // want to call `sync()` on the first run, hence `??=`.
    syncPromise ??= storage.sync();
    await setTimeout();
    await txn.put("key1", "value2");
  });
  t.is(backing.getMaybeExpired("key1"), undefined);
  await syncPromise;
  t.not(backing.getMaybeExpired("key1"), undefined);
});

test("hides implementation details", (t) => {
  const { storage } = t.context;
  t.deepEqual(getObjectProperties(storage), [
    "delete",
    "deleteAlarm",
    "deleteAll",
    "get",
    "getAlarm",
    "list",
    "put",
    "setAlarm",
    "sync",
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
    "deleteAlarm",
    "deleteAll",
    "get",
    "getAlarm",
    "list",
    "put",
    "rollback",
    "setAlarm",
  ]);
});
