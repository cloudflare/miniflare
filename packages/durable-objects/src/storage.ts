import assert from "assert";
import { deserialize, serialize } from "v8";
import {
  Storage,
  StorageTransaction,
  StoredValue,
  viewToArray,
} from "@miniflare/shared";

const MAX_KEYS = 128;
const MAX_KEY_SIZE = 2048; /* 2KiB */
const MAX_VALUE_SIZE = 32 * 1024; /* 32KiB */
const ENFORCED_MAX_VALUE_SIZE = MAX_VALUE_SIZE + 32;

// TODO: support input gates and all these fancy options

export interface DurableObjectGetOptions {
  allowConcurrency?: boolean; // TODO: disable input gate locking
  noCache?: boolean;
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
      throw new Error(`Cannot ${op} on rolled back transaction`);
    }
    if (this[kCommitted]) {
      throw new Error(
        `Cannot call ${op} on transaction that has already committed: did you move \`txn\` outside of the closure?`
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

  get<Value = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<Value | undefined>;
  get<Value = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, Value>>;
  async get<Value = unknown>(
    keys: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    this.#check("get()");
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
    valueOptions?: Value | DurableObjectPutOptions
  ): Promise<void> {
    this.#check("put()");
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

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  delete(keys: string | string[]): Promise<boolean | number> {
    this.#check("delete()");
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

  deleteAll(): never {
    throw new Error("Cannot call deleteAll() within a transaction");
  }

  async list<Value = unknown>(
    options: DurableObjectListOptions = {}
  ): Promise<Map<string, Value>> {
    this.#check("list()");
    if (options.limit !== undefined && options.limit <= 0) {
      throw new TypeError("List limit must be positive.");
    }
    const listOptions = {
      start: options.start,
      end: options.end,
      prefix: options.prefix,
      reverse: options.reverse,
      limit: options.limit,
    };
    const { keys } = await this[kTxn].list(listOptions, true);
    return this.get(keys.map(({ name }) => name));
  }

  rollback(): void {
    // Allow multiple rollback() calls
    if (this.#rolledback) return;
    this.#check("rollback()");
    this.#rolledback = true;
    this[kTxn].rollback();
  }
}

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
    return this.transaction((txn) => txn.get(keys as any, options));
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
    return this.transaction((txn) =>
      txn.put(keyEntries as any, valueOptions, options)
    );
  }

  delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  async delete(
    keys: string | string[],
    options?: DurableObjectPutOptions
  ): Promise<boolean | number> {
    return this.transaction((txn) => txn.delete(keys as any, options));
  }

  async deleteAll(_options?: DurableObjectPutOptions): Promise<void> {
    return this.transaction(async (txn) => {
      // Bypassing max key checks, and actually getting keys' values too
      const { keys } = await txn[kTxn].list();
      await txn[kTxn].deleteMany(keys.map(({ name }) => name));
    });
  }

  async list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    return this.transaction((txn) => txn.list(options));
  }

  async transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    return this.#storage.transaction(async (txn) => {
      const durableObjectTxn = new DurableObjectTransaction(txn);
      const result = await closure(durableObjectTxn);
      // Might not actually commit, this is just for #check()
      durableObjectTxn[kCommitted] = true;
      return result;
    });
  }
}
