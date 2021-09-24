import { setTimeout } from "timers/promises";
import { StorageTransaction, StoredValue } from "@miniflare/shared";
import { Macro } from "ava";
import { utf8Decode, utf8Encode } from "test:@miniflare/shared";
import { TestStorageFactory, keyNames } from "./shared";

function incrementTransaction(...keys: string[]) {
  return async (txn: StorageTransaction) => {
    const values = await txn.getMany(keys, true);
    const newValues = values.map<[key: string, value: StoredValue]>(
      (value, i) => {
        const count = value ? parseInt(utf8Decode(value.value)) : 0;
        return [keys[i], { value: utf8Encode((count + 1).toString()) }];
      }
    );
    // Allow other transactions to start running (we want conflicts)
    await setTimeout();
    await txn.putMany(newValues);
  };
}

export const txnGetUncommittedMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
  });
  await storage.transaction(async (txn) => {
    // Test overwriting existing key
    await txn.put("key1", { value: utf8Encode("new") });
    t.is(utf8Decode((await txn.get("key1"))?.value), "new");
    t.is(utf8Decode((await storage.get("key1"))?.value), "value1");

    // Test deleting key
    await txn.delete("key2");
    t.is(await txn.get("key2"), undefined);
    t.not(await storage.get("key2"), undefined);

    // Test creating new key
    await txn.put("key3", { value: utf8Encode("value3") });
    t.is(utf8Decode((await txn.get("key3"))?.value), "value3");
    t.is(await storage.get("key3"), undefined);
  });
};
txnGetUncommittedMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: gets uncommitted values`;

export const txnGetMixedMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    key1: { value: utf8Encode("value1") },
    key3: { value: utf8Encode("value3") },
  });
  await storage.transaction(async (txn) => {
    await txn.put("key2", { value: utf8Encode("value2") });
    await txn.delete("key3");
    const values = await txn.getMany(["key1", "key2", "key3"]);
    t.is(values.length, 3);
    t.is(utf8Decode(values[0]?.value), "value1"); // committed
    t.is(utf8Decode(values[1]?.value), "value2"); // uncommitted
    t.is(values[2], undefined);
  });
};
txnGetMixedMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: gets committed and uncommitted values in same transaction`;

export const txnDeleteNewMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  t.plan(2);
  const storage = await factory(t, {});
  await storage.transaction(async (txn) => {
    await txn.put("key", { value: utf8Encode("value") });
    t.true(await txn.delete("key"));
  });
  t.is(await storage.get("key"), undefined);
};
txnDeleteNewMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: reports key added during transaction deleted`;

export const txnListNewMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    key1: { value: utf8Encode("value1") },
    key3: { value: utf8Encode("value3") },
  });
  await storage.transaction(async (txn) => {
    await txn.put("key2", { value: utf8Encode("value2") });
    const { keys } = await txn.list();
    t.deepEqual(keyNames(keys), ["key1", "key2", "key3"]);
  });
};
txnListNewMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: includes key added during transaction in list`;

export const txnCommitSingleMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    a: { value: utf8Encode("1") },
    b: { value: utf8Encode("2") },
  });
  const txn = incrementTransaction("a", "b");
  await storage.transaction(txn);
  const results = await storage.getMany(["a", "b"], true);
  t.is(utf8Decode(results[0]?.value), "2");
  t.is(utf8Decode(results[1]?.value), "3");
};
txnCommitSingleMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: commits single transaction`;

export const txnCommitConcurrentDisjointMacro: Macro<[TestStorageFactory]> =
  async (t, { factory }) => {
    const storage = await factory(t, {
      a: { value: utf8Encode("1") },
      b: { value: utf8Encode("2") },
    });
    const txnA = incrementTransaction("a");
    const txnB = incrementTransaction("b");
    await Promise.all([storage.transaction(txnA), storage.transaction(txnB)]);
    const results = await storage.getMany(["a", "b"], true);
    t.is(utf8Decode(results[0]?.value), "2");
    t.is(utf8Decode(results[1]?.value), "3");
  };
txnCommitConcurrentDisjointMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: commits concurrent transactions operating on disjoint keys`;

export const txnRetryConcurrentConflictingMacro: Macro<[TestStorageFactory]> =
  async (t, { factory }) => {
    const storage = await factory(t, {
      a: { value: utf8Encode("1") },
      b: { value: utf8Encode("2") },
    });
    const txnA = incrementTransaction("a");
    const txnB = incrementTransaction("a", "b");
    await Promise.all([storage.transaction(txnA), storage.transaction(txnB)]);
    const results = await storage.getMany(["a", "b"], true);
    t.is(utf8Decode(results[0]?.value), "3");
    t.is(utf8Decode(results[1]?.value), "3");
  };
txnRetryConcurrentConflictingMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: retries concurrent transactions operating on conflicting keys`;

export const txnRetryConcurrentSingleMacro: Macro<[TestStorageFactory]> =
  async (t, { factory }) => {
    const storage = await factory(t, {
      a: { value: utf8Encode("1") },
    });
    const txn = incrementTransaction("a");
    await Promise.all(
      Array.from(Array(10)).map(() => storage.transaction(txn))
    );
    const result = await storage.get("a", true);
    t.is(utf8Decode(result?.value), "11");
  };
txnRetryConcurrentSingleMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: retries concurrent transactions operating on single key`;

export const txnRollbackMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    key: { value: utf8Encode("old") },
  });
  await storage.transaction(async (txn) => {
    await txn.put("key", { value: utf8Encode("new") });
    txn.rollback();
  });
  t.is(utf8Decode((await storage.get("key"))?.value), "old");
};
txnRollbackMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: rolledback transaction doesn't commit`;

export const txnPropagateMacro: Macro<[TestStorageFactory]> = async (
  t,
  { factory }
) => {
  const storage = await factory(t, {
    a: { value: utf8Encode("1") },
  });
  const res = await storage.transaction(async (txn) => {
    const value = await txn.get("a");
    const count = value ? parseInt(utf8Decode(value.value)) : 0;
    return count + 2;
  });
  t.is(res, 3);
};
txnPropagateMacro.title = (providedTitle, { name }) =>
  `${name}: transaction: propagates return value`;

// TODO: expiration/metadata too
// TODO: list stuff, clones (mutating old values)
// TODO: test getting some keys with skipMetadata and some without (make sure to do skip first, then with)

export {};
