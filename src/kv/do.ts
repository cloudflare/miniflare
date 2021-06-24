import assert from "assert";
import Typeson from "typeson";
// @ts-expect-error typeson-registry doesn't have types
import structuredCloneThrowing from "typeson-registry/dist/presets/structured-cloning-throwing";
import { Mutex, intersects } from "./helpers";
import { KVStorage } from "./storage";

const collator = new Intl.Collator();
const TSON = new Typeson().register(structuredCloneThrowing);

export interface DurableObjectListOptions {
  start?: string;
  end?: string;
  reverse?: boolean;
  limit?: number;
  prefix?: string;
}

export interface DurableObjectOperator {
  get<Value = unknown>(key: string): Promise<Value | undefined>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;

  // TODO: implement this properly, our semantics are slightly different
  //  to Cloudflare's
  deleteAll(): Promise<void>;

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>>;
}

// Durable Object transactions are implemented using Optimistic Concurrency
// Control as described in https://dl.acm.org/doi/10.1145/319566.319567.
// The toy implementation here https://github.com/mwhittaker/occ is also very
// helpful.

export class DurableObjectTransaction implements DurableObjectOperator {
  readonly _readSet = new Set<string>();
  readonly _copies = new Map<string, Buffer | undefined>();
  _rolledback = false;

  constructor(private _storage: KVStorage, public _startTxnCount: number) {}

  get _writeSet(): Set<string> {
    return new Set(this._copies.keys());
  }

  private async _get(key: string): Promise<Buffer | undefined> {
    this._readSet.add(key);
    if (this._copies.has(key)) {
      // Value may be undefined if key deleted so need explicit has
      return this._copies.get(key);
    } else {
      return (await this._storage.get(key))?.value;
    }
  }

  get<Value = unknown>(key: string): Promise<Value | undefined>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  async get<Value = unknown>(
    keys: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    assert(!this._rolledback);
    if (Array.isArray(keys)) {
      // If array of keys passed, build map of results
      const values = new Map<string, Value>();
      for (const key of keys) {
        const value = await this._get(key);
        if (value) values.set(key, TSON.parse(value.toString("utf8")));
      }
      return values;
    } else {
      // Otherwise, return a single result
      const value = await this._get(keys);
      return value ? TSON.parse(value.toString("utf8")) : undefined;
    }
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  async put<Value = unknown>(
    entries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    assert(!this._rolledback);
    // If a single key/value pair was passed, normalise it to an object
    if (typeof entries === "string") {
      assert(value !== undefined);
      entries = { [entries]: value };
    }
    // Update shadow copies for each entry, and record operation in write log
    for (const [key, rawValue] of Object.entries(entries)) {
      const value = Buffer.from(TSON.stringify(rawValue), "utf8");
      this._copies.set(key, value);
    }
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  async delete(keys: string | string[]): Promise<boolean | number> {
    assert(!this._rolledback);
    // Record whether an array was passed so we know what to return at the end
    const arrayKeys = Array.isArray(keys);
    // Normalise keys argument to string array
    if (!Array.isArray(keys)) keys = [keys];
    // Delete shadow copies for each entry, and record operation in write log
    let deleted = 0;
    for (const key of keys) {
      this._readSet.add(key);
      deleted += (await this._storage.has(key)) ? 1 : 0;
      this._copies.set(key, undefined);
    }
    return arrayKeys ? deleted : deleted > 0;
  }

  async deleteAll(): Promise<void> {
    assert(!this._rolledback);
    // Delete all existing keys
    // TODO: think about whether it's correct to use list() here, what if a
    //  transaction adding a new commits before this commits?
    const keys = (await this._storage.list()).map(({ name }) => name);
    await this.delete(keys);
  }

  async list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    assert(!this._rolledback);
    // Get all matching key names, sorted
    const direction = options?.reverse ? 1 : -1;
    // TODO: check whether reverse is applied during filter, not after
    let keys = (await this._storage.list())
      .filter(({ name }) => {
        return !(
          (options?.prefix && !name.startsWith(options.prefix)) ||
          (options?.start && collator.compare(name, options.start) < 0) ||
          (options?.end && collator.compare(name, options.end) >= 0)
        );
      })
      .map(({ name }) => name)
      .sort((a, b) => direction * collator.compare(b, a));
    // Truncate keys to the limit if one is specified
    if (options?.limit) keys = keys.slice(0, options.limit);
    // Get keys' values
    return this.get(keys);
  }

  rollback(): void {
    assert(!this._rolledback);
    this._rolledback = true;
  }
}

// Maximum size of _txnWriteSets map for validation, this is basically the
// maximum number of concurrent transactions we expect to be running on a single
// storage instance
const txnMapSize = 16;

export class DurableObjectStorage implements DurableObjectOperator {
  _txnCount = 0;
  private _txnWriteSets = new Map<number, Set<string>>();
  private _mutex = new Mutex();

  // TODO: probably want a way to abort all in-progress transactions when
  //  reloading worker

  constructor(private _storage: KVStorage) {}

  async _transactionRead<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<{ txn: DurableObjectTransaction; result: T }> {
    // 1. Read Phase
    const txn = new DurableObjectTransaction(this._storage, this._txnCount);
    const result = await closure(txn);
    return { txn, result };
  }

  async _transactionValidateAndWrite(
    txn: DurableObjectTransaction
  ): Promise<boolean> {
    // Mutex needed as write phase is asynchronous and these phases need to be
    // performed as a critical section
    return this._mutex.run(async () => {
      // 2. Validate Phase
      const finishTxnCount = this._txnCount;
      for (let t = txn._startTxnCount + 1; t <= finishTxnCount; t++) {
        const otherTxnWriteSet = this._txnWriteSets.get(t);
        if (!otherTxnWriteSet || intersects(otherTxnWriteSet, txn._readSet)) {
          return false;
        }
      }

      // 3. Write Phase
      for (const [key, value] of txn._copies.entries()) {
        if (value) {
          await this._storage.put(key, { value });
        } else {
          await this._storage.delete(key);
        }
      }

      this._txnCount++;
      this._txnWriteSets.set(this._txnCount, txn._writeSet);
      // Keep _txnWriteSets.size <= txnMapSize (if deleted key is negative,
      // i.e. transaction never existed, map delete won't do anything)
      this._txnWriteSets.delete(this._txnCount - txnMapSize);
      return true;
    });
  }

  private async _transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    // TODO: maybe throw exception after n retries?
    while (true) {
      const { txn, result } = await this._transactionRead(closure);
      if (txn._rolledback) return result; // TODO: check if storage disposed?
      if (await this._transactionValidateAndWrite(txn)) return result;
    }
  }

  get<Value = unknown>(key: string): Promise<Value | undefined>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  get<Value = unknown>(
    key: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    return this._transaction((txn) => txn.get(key as any));
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    return this._transaction((txn) => txn.put(keyEntries as any, value));
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  delete(key: string | string[]): Promise<boolean | number> {
    return this._transaction((txn) => txn.delete(key as any));
  }

  deleteAll(): Promise<void> {
    return this._transaction((txn) => txn.deleteAll());
  }

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    return this._transaction((txn) => txn.list(options));
  }

  async transaction(
    closure: (txn: DurableObjectTransaction) => Promise<void>
  ): Promise<void> {
    await this._transaction(closure);
  }
}
