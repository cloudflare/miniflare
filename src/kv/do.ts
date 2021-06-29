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

const internalsMap = new WeakMap<
  DurableObjectTransaction,
  DurableObjectTransactionInternals
>();

// Class containing everything related to DurableObjectTransactions that needs
// to be accessible to DurableObjectStorage
class DurableObjectTransactionInternals {
  readonly readSet = new Set<string>();
  readonly copies = new Map<string, Buffer | undefined>();
  rolledback = false;

  constructor(public startTxnCount: number) {}

  get writeSet(): Set<string> {
    return new Set(this.copies.keys());
  }
}

export class DurableObjectTransaction implements DurableObjectOperator {
  readonly #storage: KVStorage;

  constructor(storage: KVStorage, startTxnCount: number) {
    this.#storage = storage;
    internalsMap.set(
      this,
      new DurableObjectTransactionInternals(startTxnCount)
    );
  }

  get #internals(): DurableObjectTransactionInternals {
    const internals = internalsMap.get(this);
    assert(internals);
    return internals;
  }

  async #get(key: string): Promise<Buffer | undefined> {
    const internals = this.#internals;
    internals.readSet.add(key);
    if (internals.copies.has(key)) {
      // Value may be undefined if key deleted so need explicit has
      return internals.copies.get(key);
    } else {
      return (await this.#storage.get(key))?.value;
    }
  }

  get<Value = unknown>(key: string): Promise<Value | undefined>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  async get<Value = unknown>(
    keys: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    const internals = this.#internals;
    assert(!internals.rolledback);
    if (Array.isArray(keys)) {
      // If array of keys passed, build map of results
      const values = new Map<string, Value>();
      for (const key of keys) {
        const value = await this.#get(key);
        if (value) values.set(key, TSON.parse(value.toString("utf8")));
      }
      return values;
    } else {
      // Otherwise, return a single result
      const value = await this.#get(keys);
      return value ? TSON.parse(value.toString("utf8")) : undefined;
    }
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  async put<Value = unknown>(
    entries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    const internals = this.#internals;
    assert(!internals.rolledback);
    // If a single key/value pair was passed, normalise it to an object
    if (typeof entries === "string") {
      assert(value !== undefined);
      entries = { [entries]: value };
    }
    // Update shadow copies for each entry, and record operation in write log
    for (const [key, rawValue] of Object.entries(entries)) {
      const value = Buffer.from(TSON.stringify(rawValue), "utf8");
      internals.copies.set(key, value);
    }
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  async delete(keys: string | string[]): Promise<boolean | number> {
    const internals = this.#internals;
    assert(!internals.rolledback);
    // Record whether an array was passed so we know what to return at the end
    const arrayKeys = Array.isArray(keys);
    // Normalise keys argument to string array
    if (!Array.isArray(keys)) keys = [keys];
    // Delete shadow copies for each entry, and record operation in write log
    let deleted = 0;
    for (const key of keys) {
      internals.readSet.add(key);
      deleted += (await this.#storage.has(key)) ? 1 : 0;
      internals.copies.set(key, undefined);
    }
    return arrayKeys ? deleted : deleted > 0;
  }

  async deleteAll(): Promise<void> {
    assert(!this.#internals.rolledback);
    // Delete all existing keys
    // TODO: think about whether it's correct to use list() here, what if a
    //  transaction adding a new commits before this commits?
    const keys = (await this.#storage.list()).map(({ name }) => name);
    await this.delete(keys);
  }

  async list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    assert(!this.#internals.rolledback);
    // Get all matching key names, sorted
    const direction = options?.reverse ? 1 : -1;
    // TODO: check whether reverse is applied during filter, not after
    let keys = (await this.#storage.list())
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
    const internals = this.#internals;
    assert(!internals.rolledback);
    internals.rolledback = true;
  }
}

// Maximum size of _txnWriteSets map for validation, this is basically the
// maximum number of concurrent transactions we expect to be running on a single
// storage instance
const txnMapSize = 16;

// Private methods of DurableObjectStorage exposed for testing
export const transactionReadSymbol = Symbol(
  "DurableObjectStorage transactionRead"
);
export const transactionValidateWriteSymbol = Symbol(
  "DurableObjectStorage transactionValidateAndWrite"
);
// Private method of DurableObjectStorage exposed for module
export const abortAllSymbol = Symbol("DurableObjectStorage abortAll");

export class DurableObjectStorage implements DurableObjectOperator {
  #txnCount = 0;
  #txnWriteSets = new Map<number, Set<string>>();
  #mutex = new Mutex();
  #abortedAll = false;
  readonly #storage: KVStorage;

  constructor(storage: KVStorage) {
    this.#storage = storage;
  }

  async [transactionReadSymbol]<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<{ txn: DurableObjectTransaction; result: T }> {
    // 1. Read Phase
    const txn = new DurableObjectTransaction(this.#storage, this.#txnCount);
    const result = await closure(txn);
    return { txn, result };
  }

  async [transactionValidateWriteSymbol](
    txn: DurableObjectTransaction
  ): Promise<boolean> {
    // This function returns false iff the transaction should be retried

    const internals = internalsMap.get(txn);
    assert(internals);
    // Don't commit if rolledback or aborted all
    if (internals.rolledback || this.#abortedAll) return true;

    // Mutex needed as write phase is asynchronous and these phases need to be
    // performed as a critical section
    return this.#mutex.run(async () => {
      // 2. Validate Phase
      const finishTxnCount = this.#txnCount;
      for (let t = internals.startTxnCount + 1; t <= finishTxnCount; t++) {
        const otherWriteSet = this.#txnWriteSets.get(t);
        if (!otherWriteSet || intersects(otherWriteSet, internals.readSet)) {
          return false;
        }
      }

      // 3. Write Phase
      for (const [key, value] of internals.copies.entries()) {
        if (value) {
          await this.#storage.put(key, { value });
        } else {
          await this.#storage.delete(key);
        }
      }

      this.#txnCount++;
      this.#txnWriteSets.set(this.#txnCount, internals.writeSet);
      // Keep _txnWriteSets.size <= txnMapSize (if deleted key is negative,
      // i.e. transaction never existed, map delete won't do anything)
      this.#txnWriteSets.delete(this.#txnCount - txnMapSize);
      return true;
    });
  }

  [abortAllSymbol](): void {
    this.#abortedAll = true;
  }

  async #transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    // TODO: (low priority) maybe throw exception after n retries?
    while (true) {
      const { txn, result } = await this[transactionReadSymbol](closure);
      if (await this[transactionValidateWriteSymbol](txn)) return result;
    }
  }

  get<Value = unknown>(key: string): Promise<Value | undefined>;
  get<Value = unknown>(keys: string[]): Promise<Map<string, Value>>;
  get<Value = unknown>(
    key: string | string[]
  ): Promise<Value | undefined | Map<string, Value>> {
    return this.#transaction((txn) => txn.get(key as any));
  }

  put<Value = unknown>(key: string, value: Value): Promise<void>;
  put<Value = unknown>(entries: Record<string, Value>): Promise<void>;
  put<Value = unknown>(
    keyEntries: string | Record<string, Value>,
    value?: Value
  ): Promise<void> {
    return this.#transaction((txn) => txn.put(keyEntries as any, value));
  }

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  delete(key: string | string[]): Promise<boolean | number> {
    return this.#transaction((txn) => txn.delete(key as any));
  }

  deleteAll(): Promise<void> {
    return this.#transaction((txn) => txn.deleteAll());
  }

  list<Value = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, Value>> {
    return this.#transaction((txn) => txn.list(options));
  }

  async transaction(
    closure: (txn: DurableObjectTransaction) => Promise<void>
  ): Promise<void> {
    await this.#transaction(closure);
  }
}
