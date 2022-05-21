import assert from "assert";
import { deserialize, serialize } from "v8";
import {
  OutputGate,
  Storage,
  StoredValue,
  addAll,
  runWithInputGateClosed,
  viewToArray,
  waitUntilOnOutputGate,
} from "@miniflare/shared";
import { DurableObjectError } from "./error";
import { ReadWriteMutex } from "./rwmutex";
import { ShadowStorage } from "./shadow";

const MAX_KEYS = 128;
const MAX_KEY_SIZE = 2048; /* 2KiB */
const MAX_VALUE_SIZE = 128 * 1024; /* 128KiB */
// As V8 serialisation adds some tagging information, Workers actually allows
// values to be 32 bytes greater than the advertised limit. This allows 128KiB
// byte arrays to be stored for example.
const ENFORCED_MAX_VALUE_SIZE = MAX_VALUE_SIZE + 32;

const undefinedKeyError =
  ": parameter 1 is not of type 'variant'. (key is undefined)";

function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

export interface DurableObjectGetOptions {
  allowConcurrency?: boolean;
  noCache?: boolean; // Currently ignored
}

export interface DurableObjectPutOptions extends DurableObjectGetOptions {
  allowUnconfirmed?: boolean;
}

export interface DurableObjectListOptions extends DurableObjectGetOptions {
  start?: string;
  end?: string;
  prefix?: string;
  reverse?: boolean;
  limit?: number;
}

export interface DurableObjectOperator {
  get<Value = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined>;
  get<Value = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, Value>>;

  put<Value = unknown>(
    key: string,
    value: Value,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<Value = unknown>(
    entries: Record<string, Value>,
    options?: DurableObjectPutOptions
  ): Promise<void>;

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>>;
}

function assertKeySize(key: string, many = false) {
  if (Buffer.byteLength(key) <= MAX_KEY_SIZE) return;
  if (many) {
    throw new RangeError(
      `Key "${key}" is larger than the limit of ${MAX_KEY_SIZE} bytes.`
    );
  }
  throw new RangeError(`Keys cannot be larger than ${MAX_KEY_SIZE} bytes.`);
}

function assertValueSize(value: Buffer, key?: string) {
  if (value.byteLength <= ENFORCED_MAX_VALUE_SIZE) return;
  if (key !== undefined) {
    throw new RangeError(
      `Value for key "${key}" is above the limit of ${MAX_VALUE_SIZE} bytes.`
    );
  }
  throw new RangeError(`Values cannot be larger than ${MAX_VALUE_SIZE} bytes.`);
}

function helpfulDeserialize(buffer: NodeJS.TypedArray): any {
  try {
    return deserialize(buffer);
  } catch (e: any) {
    throw new DurableObjectError(
      "ERR_DESERIALIZATION",
      "Unable to deserialize stored Durable Object data due to an " +
        "invalid or unsupported version.\nThe Durable Object data storage " +
        "format changed in Miniflare 2. You cannot load Durable Object data " +
        "created with Miniflare 1 and must delete it.",
      e
    );
  }
}

async function get<Value = unknown>(
  storage: Storage,
  key: string,
  checkMaxKeys?: boolean
): Promise<Value | undefined>;
// noinspection JSUnusedLocalSymbols
async function get<Value = unknown>(
  storage: Storage,
  keys: string[],
  checkMaxKeys?: boolean
): Promise<Map<string, Value>>;
async function get<Value = unknown>(
  storage: Storage,
  keys: string | string[],
  checkMaxKeys = true
): Promise<Value | undefined | Map<string, Value>> {
  if (Array.isArray(keys)) {
    if (checkMaxKeys && keys.length > MAX_KEYS) {
      throw new RangeError(`Maximum number of keys is ${MAX_KEYS}.`);
    }
    // Filter out undefined keys
    const defined: string[] = [];
    for (const key of keys) {
      if (key === undefined) continue;
      defined.push(key);
      assertKeySize(key, true);
    }
    // If array of keys passed, build map of results
    const res = new Map<string, Value>();
    const values = await storage.getMany(defined);
    assert.strictEqual(defined.length, values.length);
    for (let i = 0; i < defined.length; i++) {
      const value = values[i];
      if (value !== undefined) {
        res.set(defined[i], helpfulDeserialize(value.value));
      }
    }
    return res;
  }

  // Otherwise, return a single result
  assertKeySize(keys);
  const value = await storage.get(keys);
  return value && helpfulDeserialize(value.value);
}

async function list<Value = unknown>(
  storage: Storage,
  options: DurableObjectListOptions = {}
): Promise<Map<string, Value>> {
  if (options.limit !== undefined && options.limit <= 0) {
    throw new TypeError("List limit must be positive.");
  }
  const { keys } = await storage.list(options);
  return get(
    storage,
    keys.map(({ name }) => name),
    // Allow listing more than MAX_KEYS keys
    false /* checkMaxKeys */
  );
}

function normalisePutEntries<Value = unknown>(
  keyEntries: string | Record<string, Value>,
  valueOptions?: Value
): [key: string, value: StoredValue][] {
  if (typeof keyEntries === "string") {
    assertKeySize(keyEntries);
    if (valueOptions === undefined) {
      throw new TypeError("put() called with undefined value.");
    }
    const serialized = serialize(valueOptions);
    assertValueSize(serialized);
    return [[keyEntries, { value: viewToArray(serialized) }]];
  }

  const entries = Object.entries(keyEntries);
  if (entries.length > MAX_KEYS) {
    throw new RangeError(`Maximum number of pairs is ${MAX_KEYS}.`);
  }
  const result: [key: string, value: StoredValue][] = [];
  for (const [key, rawValue] of entries) {
    assertKeySize(key, true);
    if (rawValue === undefined) continue;
    const serialized = serialize(rawValue);
    assertValueSize(serialized, key);
    result.push([key, { value: viewToArray(serialized) }]);
  }
  return result;
}

function normaliseDeleteKeys(keys: string | string[]): string[] {
  if (Array.isArray(keys)) {
    if (keys.length > MAX_KEYS) {
      throw new RangeError(`Maximum number of keys is ${MAX_KEYS}.`);
    }
    const defined: string[] = [];
    for (const key of keys) {
      if (key === undefined) continue;
      assertKeySize(key, true);
      defined.push(key);
    }
    return defined;
  } else {
    assertKeySize(keys);
    return [keys];
  }
}

const kInner = Symbol("kInner");
const kStartTxnCount = Symbol("kStartTxnCount");
const kRolledback = Symbol("kRolledback");
const kCommitted = Symbol("kCommitted");
const kWriteSet = Symbol("kWriteSet");

export class DurableObjectTransaction implements DurableObjectOperator {
  readonly [kInner]: ShadowStorage;
  readonly [kStartTxnCount]: number;
  [kRolledback] = false;
  [kCommitted] = false;
  readonly [kWriteSet] = new Set<string>();

  constructor(inner: Storage, startTxnCount: number) {
    this[kInner] = new ShadowStorage(inner);
    this[kStartTxnCount] = startTxnCount;
  }

  #check(op: string): void {
    if (this[kRolledback]) {
      throw new Error(`Cannot ${op}() on rolled back transaction`);
    }
    if (this[kCommitted]) {
      throw new Error(
        `Cannot call ${op}() on transaction that has already committed: did you move \`txn\` outside of the closure?`
      );
    }
  }

  #markWritten(...keys: string[]): void {
    addAll(this[kWriteSet], keys);
    if (this[kWriteSet].size > MAX_KEYS) {
      throw new Error(
        `Maximum number of keys modified in a transaction is ${MAX_KEYS}.`
      );
    }
  }

  get<Value = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined>;
  get<Value = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, Value>>;
  get<Value = unknown>(
    keys: string | string[],
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined | Map<string, Value>> {
    if (keys === undefined) {
      throw new TypeError(
        "Failed to execute 'get' on 'DurableObjectTransaction'" +
          undefinedKeyError
      );
    }
    this.#check("get");
    return runWithInputGateClosed(
      () => get(this[kInner], keys as any),
      options?.allowConcurrency
    );
  }

  #put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    valueOptions?: Value
  ): Promise<void> {
    const entries = normalisePutEntries(keyEntries, valueOptions);
    this.#markWritten(...entries.map(([key]) => key));
    return this[kInner].putMany(entries);
  }

  put<Value = unknown>(
    key: string,
    value: Value,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<Value = unknown>(
    entries: Record<string, Value>,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    valueOptions?: Value | DurableObjectPutOptions,
    options?: DurableObjectPutOptions
  ): Promise<void> {
    if (keyEntries === undefined) {
      throw new TypeError(
        "Failed to execute 'put' on 'DurableObjectTransaction'" +
          undefinedKeyError
      );
    }
    this.#check("put");
    if (!options && typeof keyEntries !== "string") options = valueOptions;
    return waitUntilOnOutputGate(
      runWithInputGateClosed(
        () => this.#put(keyEntries, valueOptions),
        options?.allowConcurrency
      ),
      options?.allowUnconfirmed
    );
  }

  #delete(keys: string | string[]): Promise<boolean | number> {
    const keysIsArray = Array.isArray(keys);
    keys = normaliseDeleteKeys(keys);
    this.#markWritten(...keys);
    return keysIsArray
      ? this[kInner].deleteMany(keys)
      : Promise.resolve(this[kInner].delete(keys[0]));
  }

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  delete(
    keys: string | string[],
    options?: DurableObjectPutOptions
  ): Promise<boolean | number> {
    if (keys === undefined) {
      throw new TypeError(
        "Failed to execute 'delete' on 'DurableObjectTransaction'" +
          undefinedKeyError
      );
    }
    this.#check("delete");
    return waitUntilOnOutputGate(
      runWithInputGateClosed(
        () => this.#delete(keys),
        options?.allowConcurrency
      ),
      options?.allowUnconfirmed
    );
  }

  deleteAll(): never {
    throw new Error("Cannot call deleteAll() within a transaction");
  }

  list<Value = unknown>(
    options: DurableObjectListOptions = {}
  ): Promise<Map<string, Value>> {
    this.#check("list");
    return runWithInputGateClosed(
      () => list(this[kInner], options),
      options.allowConcurrency
    );
  }

  rollback(): void {
    if (this[kRolledback]) return; // Allow multiple rollback() calls
    this.#check("rollback");
    this[kRolledback] = true;
  }
}

// Maximum size of txnWriteSets map for validation, this is basically the
// maximum number of concurrent transactions we expect to be running on a single
// storage instance
const txnWriteSetsMaxSize = 16;

function runWithGatesClosed<T>(
  closure: () => Promise<T>,
  options?: DurableObjectPutOptions
): Promise<T> {
  return waitUntilOnOutputGate(
    runWithInputGateClosed(closure, options?.allowConcurrency),
    options?.allowUnconfirmed
  );
}

export class DurableObjectStorage implements DurableObjectOperator {
  readonly #mutex = new ReadWriteMutex();

  #txnCount = 0;
  readonly #txnWriteSets = new Map<number, Set<string>>();

  // Ordered array of keys deleted in delete calls
  #deletedKeySets: string[][] = [];
  // Map array reference to number of keys deleted from that array
  readonly #deletedKeyResults = new Map<string[], number>();

  readonly #inner: Storage;
  // Shadow copies only used for write coalescing, not caching. Caching might
  // be added in the future, but it seemed redundant since most users will be
  // using in-memory storage anyways, and the file system isn't *too* slow.
  readonly #shadow: ShadowStorage;

  constructor(inner: Storage) {
    this.#inner = inner;
    // false disables recording readSet, only needed for transactions
    this.#shadow = new ShadowStorage(inner, false);
  }

  async #txnRead<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<{ txn: DurableObjectTransaction; result: T }> {
    // 1. Read Phase
    const startTxnCount = this.#txnCount;
    // Note txn uses #shadow as its inner storage, so in-progress non-durable
    // puts/deletes are visible
    const txn = new DurableObjectTransaction(this.#shadow, startTxnCount);
    const result = await closure(txn);
    // Might not actually commit, this is just for #check()
    txn[kCommitted] = true;
    return { txn, result };
  }

  async #txnValidateWrite(txn: DurableObjectTransaction): Promise<boolean> {
    // This function returns false iff the transaction should be retried

    // Don't commit if rolledback
    if (txn[kRolledback]) return true;

    // Mutex needed as these phases need to be performed as a critical section
    return this.#mutex.runWithWrite(async () => {
      // 2. Validate Phase
      const finishTxnCount = this.#txnCount;
      const readSet = txn[kInner].readSet!;
      for (let t = txn[kStartTxnCount] + 1; t <= finishTxnCount; t++) {
        const otherWriteSet = await this.#txnWriteSets.get(t);
        if (!otherWriteSet || intersects(otherWriteSet, readSet)) {
          return false;
        }
      }

      // 3. Write Phase
      this.#txnRecordWriteSet(txn[kWriteSet]);
      for (const [key, value] of txn[kInner].copies.entries()) {
        this.#shadow.copies.set(key, value);
      }
      await this.#flush();

      return true;
    });
  }

  #txnRecordWriteSet(writeSet: Set<string>): void {
    this.#txnCount++;
    this.#txnWriteSets.set(this.#txnCount, writeSet);
    // Keep txnWriteSets.size <= txnMapSize: deleted ID may be negative
    // (i.e. transaction never existed), but delete on non-existent key is noop
    this.#txnWriteSets.delete(this.#txnCount - txnWriteSetsMaxSize);
  }

  transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    // Close input and output gate, we don't know what this transaction will do
    return runWithGatesClosed(async () => {
      // TODO (someday): maybe throw exception after n retries?
      while (true) {
        const outputGate = new OutputGate();
        const { txn, result } = await outputGate.runWith(() =>
          this.#txnRead(closure)
        );
        if (await this.#txnValidateWrite(txn)) return result;
      }
    });
  }

  get<Value = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined>;
  get<Value = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, Value>>;
  async get<Value = unknown>(
    keys: string | string[],
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined | Map<string, Value>> {
    if (keys === undefined) {
      throw new TypeError(
        "Failed to execute 'get' on 'DurableObjectStorage'" + undefinedKeyError
      );
    }
    return runWithInputGateClosed(
      () => this.#mutex.runWithRead(() => get(this.#shadow, keys as any)),
      options?.allowConcurrency
    );
  }

  #flush = async (): Promise<void> => {
    // Must be called with #mutex's write lock held

    // If already flushed everything, don't flush again
    if (this.#shadow.copies.size === 0) {
      assert.strictEqual(this.#deletedKeySets.length, 0);
      return;
    }

    // Copy deletedKeySets and entries at the start of the flush, as more values
    // may be added mid-way through. These will be handled on the next flush.
    const deletedKeySets = this.#deletedKeySets;
    this.#deletedKeySets = [];
    const entries = [...this.#shadow.copies.entries()];
    // Keep non-durable data in shadow copies whilst writing, in case it's read

    // Try to delete everything before putting, so we don't delete data put
    // after call to delete. We still need to check with the database to see
    // if the keys were deleted, as the user might await the promise afterwards:
    //
    // ```js
    // // storage includes "key"
    // const promise = storage.delete("key");
    // storage.put("key", "value");
    // await promise; // should be true
    // ```
    //
    // ```js
    // // storage doesn't include "key"
    // const promise = storage.delete("key");
    // storage.put("key", "value");
    // await promise; // should be false
    // ```
    //
    // Record allDeletedKeys so we can record keys that aren't in deletedKeySets
    // (because they existed as shadow copies before hand so we know they would
    // be deleted), but still need to be deleted anyways.
    const allDeletedKeys = new Set<string>();
    for (const deleteKeySet of deletedKeySets) {
      const result = await this.#inner.deleteMany(deleteKeySet);
      this.#deletedKeyResults.set(deleteKeySet, result);
      addAll(allDeletedKeys, deleteKeySet);
    }

    const putEntries: [key: string, value: StoredValue][] = [];
    const deleteKeys: string[] = [];
    for (const [key, value] of entries) {
      if (value) putEntries.push([key, value]);
      else if (!allDeletedKeys.has(key)) deleteKeys.push(key);
    }
    if (putEntries.length > 0) await this.#inner.putMany(putEntries);
    if (deleteKeys.length > 0) await this.#inner.deleteMany(deleteKeys);

    // TODO: can probably just clear the map here: as flush must be run with
    //  the write mutex held and shadow copies are only mutated with that held,
    //  we know the map won't be mutated during the flush
    //  (check this is the only case copies #shadow.copies mutated)
    for (const [key, value] of entries) {
      // If shadow copy unchanged during flush, delete it as it's now durable,
      // otherwise, there must've been another call to put/delete which
      // will flush again with the now changed value.
      if (this.#shadow.copies.get(key) === value) {
        this.#shadow.copies.delete(key);
      }
    }
  };

  put<Value = unknown>(
    key: string,
    value: Value,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<Value = unknown>(
    entries: Record<string, Value>,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    valueOptions?: Value | DurableObjectPutOptions,
    options?: DurableObjectPutOptions
  ): Promise<void> {
    if (keyEntries === undefined) {
      throw new TypeError(
        "Failed to execute 'put' on 'DurableObjectStorage'" + undefinedKeyError
      );
    }

    const entries = normalisePutEntries(keyEntries, valueOptions);
    if (!options && typeof keyEntries !== "string") options = valueOptions;
    return runWithGatesClosed(async () => {
      await this.#mutex.runWithWrite(() => {
        for (const [key, value] of entries) this.#shadow.put(key, value);
        // "Commit" write
        this.#txnRecordWriteSet(new Set(entries.map(([key]) => key)));
      });
      // Promise.resolve() allows other puts/deletes (coalescing) before flush
      await Promise.resolve();
      return this.#mutex.runWithWrite(this.#flush);
    }, options);
  }

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  delete(
    keys: string | string[],
    options?: DurableObjectPutOptions
  ): Promise<boolean | number> {
    if (keys === undefined) {
      throw new TypeError(
        "Failed to execute 'delete' on 'DurableObjectStorage'" +
          undefinedKeyError
      );
    }

    // Record this so we know whether to return a boolean or number at the end
    const keysIsArray = Array.isArray(keys);
    keys = normaliseDeleteKeys(keys);
    let deleted = 0;
    const deletedKeySet: string[] = [];

    return runWithGatesClosed(async () => {
      await this.#mutex.runWithWrite(() => {
        for (const key of keys) {
          // Filter out undefined keys
          if (key === undefined) continue;

          if (this.#shadow.copies.has(key)) {
            if (this.#shadow.copies.get(key) !== undefined) {
              // Previously called put with this key, no need to check if it got
              // deleted, we know it will
              deleted++;
            }
            // ...else, previously called delete with this key, no need to check if
            // it got deleted, we know it already has
          } else {
            // If we haven't done anything with this key yet, we need to check with
            // the database whether it's deleted
            deletedKeySet.push(key);
          }
          // Not using this.#shadow.delete as we need this to be synchronous
          this.#shadow.copies.set(key, undefined);
        }
        // If there are keys we need to check if deleted, record them, we'll do this
        // when we flush
        if (deletedKeySet.length) this.#deletedKeySets.push(deletedKeySet);

        // "Commit" delete
        this.#txnRecordWriteSet(new Set(keys));
      });

      // Promise.resolve() allows other puts/deletes (coalescing) before flush
      await Promise.resolve();
      return this.#mutex.runWithWrite(async () => {
        await this.#flush();
        if (deletedKeySet.length) {
          assert(!this.#deletedKeySets.includes(deletedKeySet));
          const result = this.#deletedKeyResults.get(deletedKeySet);
          this.#deletedKeyResults.delete(deletedKeySet);
          assert(result !== undefined);
          deleted += result;
        }
        return keysIsArray ? deleted : deleted > 0;
      });
    }, options);
  }

  async deleteAll(options?: DurableObjectPutOptions): Promise<void> {
    return runWithGatesClosed(
      () =>
        this.#mutex.runWithWrite(async () => {
          const { keys } = await this.#shadow.list();
          const names = keys.map(({ name }) => name);
          for (const key of names) this.#shadow.copies.set(key, undefined);
          this.#txnRecordWriteSet(new Set(names));
          await this.#flush();
        }),
      options
    );
  }

  async list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    return runWithInputGateClosed(
      () => this.#mutex.runWithRead(() => list(this.#shadow, options)),
      options?.allowConcurrency
    );
  }
}
