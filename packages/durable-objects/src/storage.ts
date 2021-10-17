import assert from "assert";
import { deserialize, serialize } from "v8";
import {
  Storage,
  StorageTransaction,
  StoredValue,
  runWithInputGateClosed,
  viewToArray,
  waitUntilOnOutputGate,
} from "@miniflare/shared";

const MAX_KEYS = 128;
const MAX_KEY_SIZE = 2048; /* 2KiB */
const MAX_VALUE_SIZE = 32 * 1024; /* 32KiB */
const ENFORCED_MAX_VALUE_SIZE = MAX_VALUE_SIZE + 32;

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

const kTxn = Symbol("kTxn");
const kCommitted = Symbol("kCommitted");

export class DurableObjectTransaction implements DurableObjectOperator {
  readonly [kTxn]: StorageTransaction;
  #rolledback = false;
  [kCommitted] = false;
  readonly #writeKeys = new Set<string>();

  constructor(txn: StorageTransaction) {
    this[kTxn] = txn;
  }

  #check(op: string): void {
    if (this.#rolledback) {
      throw new Error(`Cannot ${op}() on rolled back transaction`);
    }
    if (this[kCommitted]) {
      throw new Error(
        `Cannot call ${op}() on transaction that has already committed: did you move \`txn\` outside of the closure?`
      );
    }
  }

  #markWritten(...keys: string[]): void {
    for (const key of keys) this.#writeKeys.add(key);
    if (this.#writeKeys.size > MAX_KEYS) {
      throw new Error(
        `Maximum number of keys modified in a transaction is ${MAX_KEYS}.`
      );
    }
  }

  async #get<Value = unknown>(
    keys: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    if (Array.isArray(keys)) {
      if (keys.length > MAX_KEYS) {
        throw new RangeError(`Maximum number of keys is ${MAX_KEYS}.`);
      }
      // If array of keys passed, build map of results
      const res = new Map<string, Value>();
      const values = await this[kTxn].getMany(keys, true);
      assert.strictEqual(keys.length, values.length);
      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (value !== undefined) res.set(keys[i], deserialize(value.value));
      }
      return res;
    }

    // Otherwise, return a single result
    const value = await this[kTxn].get(keys, true);
    return value && deserialize(value.value);
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
    this.#check("get");
    return runWithInputGateClosed(
      () => this.#get(keys as any),
      options?.allowConcurrency
    );
  }

  #put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    valueOptions?: Value
  ): Promise<void> {
    if (typeof keyEntries === "string") {
      if (valueOptions === undefined) {
        throw new TypeError("put() called with undefined value.");
      }
      assertKeySize(keyEntries);
      const serialized = serialize(valueOptions);
      assertValueSize(serialized);
      const value = viewToArray(serialized);
      this.#markWritten(keyEntries);
      return Promise.resolve(this[kTxn].put(keyEntries, { value }));
    }

    const entries = Object.entries(keyEntries);
    if (entries.length > MAX_KEYS) {
      throw new RangeError(`Maximum number of pairs is ${MAX_KEYS}.`);
    }
    const mapped = entries.map<[key: string, value: StoredValue]>(
      ([key, rawValue]) => {
        assertKeySize(key, true);
        const serialized = serialize(rawValue);
        assertValueSize(serialized, key);
        const value = viewToArray(serialized);
        return [key, { value }];
      }
    );
    this.#markWritten(...mapped.map(([key]) => key));
    return this[kTxn].putMany(mapped);
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
    if (Array.isArray(keys)) {
      if (keys.length > MAX_KEYS) {
        throw new RangeError(`Maximum number of keys is ${MAX_KEYS}.`);
      }
      this.#markWritten(...keys);
      return this[kTxn].deleteMany(keys);
    }
    this.#markWritten(keys);
    return Promise.resolve(this[kTxn].delete(keys));
  }

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  delete(
    keys: string | string[],
    options?: DurableObjectPutOptions
  ): Promise<boolean | number> {
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
    // TODO: should there be a maximum limit of MAX_KEYS here?
    this.#check("list");
    if (options.limit !== undefined && options.limit <= 0) {
      throw new TypeError("List limit must be positive.");
    }
    return runWithInputGateClosed(async () => {
      const { keys } = await this[kTxn].list(options, true);
      return this.get(keys.map(({ name }) => name));
    }, options.allowConcurrency);
  }

  rollback(): void {
    if (this.#rolledback) return; // Allow multiple rollback() calls
    this.#check("rollback");
    this.#rolledback = true;
    this[kTxn].rollback();
  }
}

// When using implicit transactions for storage operations, there's no need
// to close gates when performing the actual storage operations as this will
// be done with the transaction itself, and the storage operation is the only
// thing these transactions do. These options disable any gates.
const bypassGatesOptions: DurableObjectPutOptions = {
  allowConcurrency: true,
  allowUnconfirmed: true,
};

export class DurableObjectStorage implements DurableObjectOperator {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
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
    return this.#transaction(
      (txn) => txn.get(keys as any, bypassGatesOptions),
      // Reading so no need for output gate, hence allowUnconfirmed: true
      { allowConcurrency: options?.allowConcurrency, allowUnconfirmed: true }
    );
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
  async put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    valueOptions?: Value | DurableObjectPutOptions,
    options?: DurableObjectPutOptions
  ): Promise<void> {
    return this.#transaction(
      (txn) => txn.put(keyEntries as any, valueOptions, bypassGatesOptions),
      options
    );
  }

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  async delete(
    keys: string | string[],
    options?: DurableObjectPutOptions
  ): Promise<boolean | number> {
    return this.#transaction(
      (txn) => txn.delete(keys as any, bypassGatesOptions),
      options
    );
  }

  async deleteAll(options?: DurableObjectPutOptions): Promise<void> {
    return this.#transaction(async (txn) => {
      // Bypassing max key checks, and actually getting keys' values too
      const { keys } = await txn[kTxn].list();
      await txn[kTxn].deleteMany(keys.map(({ name }) => name));
    }, options);
  }

  async list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    return this.#transaction(
      (txn) => txn.list({ ...options, ...bypassGatesOptions }),
      // Reading so no need for output gate, hence allowUnconfirmed: true
      { allowConcurrency: options?.allowConcurrency, allowUnconfirmed: true }
    );
  }

  #transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>,
    options?: DurableObjectPutOptions
  ): Promise<T> {
    return waitUntilOnOutputGate(
      runWithInputGateClosed(() => {
        return this.#storage.transaction(async (txn) => {
          const durableObjectTxn = new DurableObjectTransaction(txn);
          const result = await closure(durableObjectTxn);
          // Might not actually commit, this is just for #check()
          durableObjectTxn[kCommitted] = true;
          return result;
        });
      }, options?.allowConcurrency),
      options?.allowUnconfirmed
    );
  }

  transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    // Close input and output gate, we don't know what this transaction will do
    return this.#transaction(closure);
  }
}
