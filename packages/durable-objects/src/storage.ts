import assert from "assert";
import { deserialize, serialize } from "v8";
import {
  OutputGate,
  Storage,
  StoredValue,
  addAll,
  lexicographicCompare,
  runWithInputGateClosed,
  viewToArray,
  waitUntilOnOutputGate,
} from "@miniflare/shared";
import {
  ALARM_KEY,
  DurableObjectGetAlarmOptions,
  DurableObjectSetAlarmOptions,
} from "./alarms";
import { DurableObjectAlarmBridge } from "./alarms";
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
  startAfter?: string;
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

  getAlarm(options?: DurableObjectGetAlarmOptions): Promise<number | null>;

  setAlarm(
    scheduledTime: number | Date,
    options?: DurableObjectSetAlarmOptions
  ): Promise<void>;

  deleteAlarm(options?: DurableObjectSetAlarmOptions): Promise<void>;
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
  listing?: boolean
): Promise<Value | undefined>;
// noinspection JSUnusedLocalSymbols
async function get<Value = unknown>(
  storage: Storage,
  keys: string[],
  listing?: boolean
): Promise<Map<string, Value>>;
async function get<Value = unknown>(
  storage: Storage,
  keys: string | string[],
  listing = false
): Promise<Value | undefined | Map<string, Value>> {
  if (Array.isArray(keys)) {
    if (!listing && keys.length > MAX_KEYS) {
      throw new RangeError(`Maximum number of keys is ${MAX_KEYS}.`);
    }
    // Filter out undefined keys
    const defined: string[] = [];
    for (const key of keys) {
      if (key === undefined) continue;
      defined.push(key);
      assertKeySize(key, true);
    }
    if (!listing) {
      // Return results in lexicographic order if not `list()`ing (where keys
      // will already be sorted, and we may want to return in reverse)
      // https://github.com/cloudflare/miniflare/issues/393
      defined.sort(lexicographicCompare);
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
  if (options.start !== undefined && options.startAfter !== undefined) {
    throw new TypeError(
      "list() cannot be called with both start and startAfter values."
    );
  }
  options = { ...options };
  const originalLimit = options.limit;
  // Since alarms now exist in storage, add 1 to the limit to account for
  // the alarm key.
  if (options.limit !== undefined) options.limit++;
  if (options.startAfter !== undefined) {
    // If *exclusive* `startAfter` is set, set it as the *inclusive* `start`.
    // Then if `startAfter` does exist as a key, we can remove it later.
    // To ensure we still return `limit` keys in this case, add 1 to the limit
    // if one is set.
    options.start = options.startAfter;
    if (options.limit !== undefined) options.limit++;
  }

  const { keys } = await storage.list(options);
  let keyNames = keys
    .map(({ name }) => name)
    .filter((name) => name !== ALARM_KEY);

  if (options.startAfter !== undefined && keyNames[0] === options.startAfter) {
    // If the first key matched `startAfter`, remove it as this is exclusive.
    keyNames.splice(0, 1);
  }
  // Make sure the original `limit` still holds.
  if (originalLimit !== undefined) keyNames = keyNames.slice(0, originalLimit);

  return get(
    storage,
    keyNames,
    // Allow listing more than MAX_KEYS keys and disable lexicographic sort
    // (if `reverse` is `true`, we want keys to be returned in reverse)
    true /* listing */
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
export const kAlarmExists = Symbol("kAlarmExists");

export class DurableObjectTransaction implements DurableObjectOperator {
  readonly #mutex = new ReadWriteMutex();

  readonly [kInner]: ShadowStorage;
  readonly [kStartTxnCount]: number;
  [kRolledback] = false;
  [kCommitted] = false;
  readonly [kWriteSet] = new Set<string>();
  readonly [kAlarmExists]: boolean;

  constructor(inner: Storage, startTxnCount: number, alarmExists: boolean) {
    this[kInner] = new ShadowStorage(inner);
    this[kStartTxnCount] = startTxnCount;
    this[kAlarmExists] = alarmExists;
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
      () => this.#mutex.runWithRead(() => get(this[kInner], keys as any)),
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
        () =>
          this.#mutex.runWithWrite(() => this.#put(keyEntries, valueOptions)),
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
        () => this.#mutex.runWithWrite(() => this.#delete(keys)),
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
      () => this.#mutex.runWithRead(() => list(this[kInner], options)),
      options.allowConcurrency
    );
  }

  async getAlarm(
    options?: DurableObjectGetAlarmOptions
  ): Promise<number | null> {
    this.#check("getAlarm");
    if (!this[kAlarmExists]) return null;
    return runWithInputGateClosed(
      () => this.#mutex.runWithRead(() => this[kInner].getAlarm()),
      options?.allowConcurrency
    );
  }

  setAlarm(
    scheduledTime: number | Date,
    options?: DurableObjectSetAlarmOptions
  ): Promise<void> {
    this.#check("setAlarm");
    if (!this[kAlarmExists]) {
      throw new Error(
        "Your Durable Object class must have an alarm() handler in order to call setAlarm()"
      );
    }
    return waitUntilOnOutputGate(
      runWithInputGateClosed(
        () =>
          this.#mutex.runWithWrite(() => this[kInner].setAlarm(scheduledTime)),
        options?.allowConcurrency
      ),
      options?.allowUnconfirmed
    );
  }

  deleteAlarm(options?: DurableObjectSetAlarmOptions): Promise<void> {
    this.#check("deleteAlarm");
    return waitUntilOnOutputGate(
      runWithInputGateClosed(
        () => this.#mutex.runWithWrite(() => this[kInner].deleteAlarm()),
        options?.allowConcurrency
      ),
      options?.allowUnconfirmed
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
  readonly #alarmBridge?: DurableObjectAlarmBridge;
  // Let's storage know if the parent instance includes an alarm method or not
  [kAlarmExists] = true;

  constructor(inner: Storage, alarmBridge?: DurableObjectAlarmBridge) {
    this.#inner = inner;
    this.#alarmBridge = alarmBridge;
    // false disables recording readSet, only needed for transactions
    this.#shadow = new ShadowStorage(inner, false);
  }

  #pendingFlushes = 0;
  #noPendingFlushesPromise?: Promise<void>;
  #noPendingFlushesPromiseResolve?: () => void;

  async #runWrite<T>(
    closure: () => Promise<T>,
    options?: DurableObjectPutOptions
  ): Promise<T> {
    // All write operations should eventually call `flush()`, so increment the
    // pending flush count.
    this.#pendingFlushes++;
    if (this.#noPendingFlushesPromise === undefined) {
      // There are now pending flushes, so make sure we have a promise that
      // resolves when these complete.
      assert(this.#noPendingFlushesPromiseResolve === undefined);
      this.#noPendingFlushesPromise = new Promise(
        (resolve) => (this.#noPendingFlushesPromiseResolve = resolve)
      );
    }

    try {
      // All write operations should close both I/O gates, unless otherwise
      // configured.
      return await waitUntilOnOutputGate(
        runWithInputGateClosed(closure, options?.allowConcurrency),
        options?.allowUnconfirmed
      );
    } finally {
      // Either we returned successfully (calling `flush()` somewhere along
      // the line), or we threw an exception. Either way, decrement the pending
      // flush count.
      assert(this.#pendingFlushes > 0);
      assert(this.#noPendingFlushesPromiseResolve !== undefined);
      this.#pendingFlushes--;
      if (this.#pendingFlushes === 0) {
        // If there are no more pending flushes, resolve the promise.
        this.#noPendingFlushesPromiseResolve();
        this.#noPendingFlushesPromiseResolve = undefined;
        this.#noPendingFlushesPromise = undefined;
      }
    }
  }

  async #txnRead<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<{ txn: DurableObjectTransaction; result: T }> {
    // 1. Read Phase
    const startTxnCount = this.#txnCount;
    // Note txn uses #shadow as its inner storage, so in-progress non-durable
    // puts/deletes are visible
    const txn = new DurableObjectTransaction(
      this.#shadow,
      startTxnCount,
      this[kAlarmExists]
    );
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
        const otherWriteSet = this.#txnWriteSets.get(t);
        if (!otherWriteSet || intersects(otherWriteSet, readSet)) {
          return false;
        }
      }

      // 3. Write Phase
      this.#txnRecordWriteSet(txn[kWriteSet]);
      for (const [key, value] of txn[kInner].copies.entries()) {
        this.#shadow.copies.set(key, value);
      }
      this.#shadow.alarm = txn[kInner].alarm;
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
    return this.#runWrite(async () => {
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

    // flush alarm should it exist
    if (typeof this.#shadow.alarm === "number") {
      await this.#inner.put(ALARM_KEY, {
        metadata: { scheduledTime: this.#shadow.alarm },
        value: new Uint8Array(),
      });
      await this.#alarmBridge?.setAlarm(this.#shadow.alarm);
    } else if (this.#shadow.alarm === null) {
      await this.#inner.delete(ALARM_KEY);
      await this.#alarmBridge?.deleteAlarm();
    }
    this.#shadow.alarm = undefined;

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
    return this.#runWrite(async () => {
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

    return this.#runWrite(async () => {
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
    return this.#runWrite(
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

  // returns integer milliseconds since epoch or null
  async getAlarm(
    options?: DurableObjectGetAlarmOptions
  ): Promise<number | null> {
    if (!this[kAlarmExists]) return null;
    return runWithInputGateClosed(
      () => this.#mutex.runWithRead(() => this.#shadow.getAlarm()),
      options?.allowConcurrency
    );
  }

  // setAlarm accepts integer milliseconds since epoch or a js date
  async setAlarm(
    scheduledTime: number | Date,
    options?: DurableObjectSetAlarmOptions
  ): Promise<void> {
    if (!this[kAlarmExists]) {
      throw new Error(
        "Your Durable Object class must have an alarm() handler in order to call setAlarm()"
      );
    }
    return this.#runWrite(async () => {
      await this.#mutex.runWithWrite(async () => {
        await this.#shadow.setAlarm(scheduledTime);
        // "Commit" write
        this.#txnRecordWriteSet(new Set([ALARM_KEY]));
      });
      // Promise.resolve() allows other setAlarms/deleteAlarms (coalescing) before flush
      await Promise.resolve();
      return this.#mutex.runWithWrite(this.#flush);
    }, options);
  }

  async deleteAlarm(options?: DurableObjectSetAlarmOptions): Promise<void> {
    return this.#runWrite(async () => {
      await this.#mutex.runWithWrite(async () => {
        await this.#shadow.deleteAlarm();
        // "Commit" write
        this.#txnRecordWriteSet(new Set([ALARM_KEY]));
      });
      // Promise.resolve() allows other setAlarms/deleteAlarms (coalescing) before flush
      await Promise.resolve();
      return this.#mutex.runWithWrite(this.#flush);
    }, options);
  }

  sync(): Promise<void> {
    // https://community.cloudflare.com/t/2022-10-21-workers-runtime-release-notes/428663
    // https://github.com/cloudflare/workerd/pull/87
    return this.#noPendingFlushesPromise ?? Promise.resolve();
  }
}
