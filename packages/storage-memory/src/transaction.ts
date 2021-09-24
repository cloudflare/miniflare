import assert from "assert";
import {
  MaybePromise,
  StorageListOptions,
  StorageListResult,
  StorageOperator,
  StorageTransaction,
  StoredKey,
  StoredKeyMeta,
  StoredValue,
  StoredValueMeta,
} from "@miniflare/shared";
import { cloneMetadata, intersects, listFilterMatch } from "./helpers";

const collator = new Intl.Collator();

export class ShadowStorageTransaction<
  Inner extends StorageOperator = StorageOperator
> extends StorageTransaction {
  readonly readSet = new Set<string>();
  readonly copies = new Map<string, StoredValueMeta | undefined>();
  rolledback = false;

  constructor(protected readonly inner: Inner, readonly startTxnCount: number) {
    super();
  }

  protected markRead(...keys: string[]): MaybePromise<void> {
    for (const key of keys) this.readSet.add(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.hasMany([key])) > 0;
  }

  get<Meta = unknown>(
    key: string,
    skipMetadata?: false
  ): MaybePromise<StoredValueMeta<Meta> | undefined>;
  get(key: string, skipMetadata: true): MaybePromise<StoredValue | undefined>;
  async get<Meta = unknown>(
    key: string,
    skipMetadata?: boolean
  ): Promise<StoredValueMeta<Meta> | undefined> {
    return (await this.getMany<Meta>([key], skipMetadata as any))[0];
  }

  put<Meta = unknown>(
    key: string,
    value: StoredValueMeta<Meta>
  ): Promise<void> {
    return this.putMany([[key, value]]);
  }

  async delete(key: string): Promise<boolean> {
    return (await this.deleteMany([key])) > 0;
  }

  async hasMany(keys: string[]): Promise<number> {
    let count = 0;
    // Keys to batch check in inner storage
    const innerHasKeys: string[] = [];
    for (const key of keys) {
      await this.markRead(key);
      if (this.copies.has(key)) {
        count++;
      } else {
        innerHasKeys.push(key);
      }
    }
    count += await this.inner.hasMany(innerHasKeys);
    return count;
  }

  getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: false
  ): Promise<(StoredValueMeta<Meta> | undefined)[]>;
  getMany(
    keys: string[],
    skipMetadata: true
  ): Promise<(StoredValue | undefined)[]>;
  async getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: boolean
  ): Promise<(StoredValueMeta<Meta> | undefined)[]> {
    const result = new Array<StoredValueMeta<Meta> | undefined>(keys.length);
    // Keys and indices of keys to batch get from inner storage
    const innerGetKeys: string[] = [];
    const innerGetIndices: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      await this.markRead(key);
      if (this.copies.has(key)) {
        // Value may be undefined if key deleted so need explicit has
        const copy = this.copies.get(key);
        // Return fresh copy so caller can mutate without affecting stored
        result[i] = copy && {
          value: copy.value.slice(),
          expiration: copy.expiration,
          metadata: cloneMetadata(copy.metadata),
        };
      } else {
        innerGetKeys.push(key);
        innerGetIndices.push(i);
      }
    }

    // Batch get keys from storage
    assert.strictEqual(innerGetKeys.length, innerGetIndices.length);
    const innerGetResult = await this.inner.getMany<Meta>(
      innerGetKeys,
      skipMetadata as any
    );
    assert.strictEqual(innerGetKeys.length, innerGetResult.length);
    for (let i = 0; i < innerGetKeys.length; i++) {
      result[innerGetIndices[i]] = innerGetResult[i];
    }

    return result;
  }

  async putMany<Meta = unknown>(
    data: [key: string, value: StoredValueMeta<Meta>][]
  ): Promise<void> {
    for (const [key, value] of data) {
      // Store fresh copy so further mutations from caller aren't stored
      this.copies.set(key, {
        value: value.value.slice(),
        // TODO: need to handle case if key expires whilst being a shadow copy
        expiration: value.expiration,
        metadata: cloneMetadata(value.metadata),
      });
    }
    return Promise.resolve();
  }

  async deleteMany(keys: string[]): Promise<number> {
    const deleted = await this.hasMany(keys);
    for (const key of keys) this.copies.set(key, undefined);
    return deleted;
  }

  list<Meta = unknown>(
    options?: StorageListOptions,
    skipMetadata?: false
  ): MaybePromise<StorageListResult<StoredKeyMeta<Meta>>>;
  list(
    options: StorageListOptions,
    skipMetadata: true
  ): MaybePromise<StorageListResult<StoredKey>>;
  async list<Meta = unknown>(
    options?: StorageListOptions,
    skipMetadata?: boolean
  ): Promise<StorageListResult<StoredKeyMeta<Meta>>> {
    if (options?.cursor) {
      // TODO (someday): support this?
      throw new TypeError("Optimistic transactions do not support list cursor");
    }

    // Find all shadow copies matching list options and the number of these that
    // were deleted
    const matchingCopies = new Map<string, StoredValueMeta | undefined>();
    let deletedMatchingCopies = 0;
    for (const [key, value] of this.copies.entries()) {
      if (listFilterMatch(options, key)) {
        matchingCopies.set(key, value);
        if (value === undefined) deletedMatchingCopies++;
      }
    }

    // Perform list on inner storage
    let { keys } = await this.inner.list<Meta>(
      {
        ...options,
        // If limiting, fetch enough extra keys to cover deleted values
        limit: options?.limit && options.limit + deletedMatchingCopies,
      },
      skipMetadata as any
    );
    // Merge in shadow copies, filtering out deleted
    keys = keys.filter((stored) => {
      if (matchingCopies.has(stored.name)) {
        // Value may be undefined if key deleted so need explicit has
        const matching = matchingCopies.get(stored.name);
        // Make sure we don't add this entry again
        matchingCopies.delete(stored.name);
        if (matching === undefined) {
          // If deleted, remove from result...
          return false;
        } else {
          // Update stored meta with shadow, note list should always return
          // a fresh copy of the data so this is safe
          stored.expiration = matching.expiration;
          stored.metadata = cloneMetadata(matching.metadata);
        }
      }
      // ...otherwise, keep it in
      return true;
    });
    // Add remaining (non-deleted) matching copies (newly added keys)
    for (const [key, value] of matchingCopies.entries()) {
      if (value) {
        keys.push({
          name: key,
          expiration: value?.expiration,
          metadata: cloneMetadata(value.metadata),
        });
      }
    }

    // Reapply sort and limit
    const direction = options?.reverse ? -1 : 1;
    keys.sort((a, b) => direction * collator.compare(a.name, b.name));
    if (options?.limit) keys = keys.slice(0, options.limit);

    // Mark read keys as read
    await this.markRead(...keys.map(({ name }) => name));

    return { keys, cursor: "" /* unsupported */ };
  }

  rollback(): void {
    // Allow multiple calls to rollback
    this.rolledback = true;
  }

  get writeSet(): Set<string> {
    return new Set(this.copies.keys());
  }
}

// Maximum size of txnWriteSets map for validation, this is basically the
// maximum number of concurrent transactions we expect to be running on a single
// storage instance
const txnMapSize = 16;

export abstract class OptimisticTransactionManager {
  constructor(private readonly storage: StorageOperator) {}

  abstract runExclusive<T>(closure: () => Promise<T>): Promise<T>;
  abstract getTxnCount(): MaybePromise<number>;
  abstract setTxnCount(value: number): MaybePromise<void>;
  abstract getTxnWriteSet(id: number): MaybePromise<Set<string> | undefined>;
  abstract setTxnWriteSet(
    id: number,
    value: Set<string> | undefined
  ): MaybePromise<void>;

  private async read<T>(
    closure: (txn: StorageTransaction) => Promise<T>
  ): Promise<{ txn: ShadowStorageTransaction; result: T }> {
    // 1. Read Phase
    const startTxnCount = await this.getTxnCount(); // TODO: think more about whether awaiting here is ok, pretty sure it's fine, definitely test it
    const txn = new ShadowStorageTransaction(this.storage, startTxnCount);
    const result = await closure(txn);
    return { txn, result };
  }

  private async validateWrite(txn: ShadowStorageTransaction): Promise<boolean> {
    // This function returns false iff the transaction should be retried

    // Don't commit if rolledback
    if (txn.rolledback) return true;

    // Mutex needed as these phases need to be performed as a critical section
    return this.runExclusive(async () => {
      // 2. Validate Phase
      const finishTxnCount = await this.getTxnCount();
      for (let t = txn.startTxnCount + 1; t <= finishTxnCount; t++) {
        const otherWriteSet = await this.getTxnWriteSet(t);
        if (!otherWriteSet || intersects(otherWriteSet, txn.readSet)) {
          return false;
        }
      }

      // 3. Write Phase
      const putEntries: [key: string, value: StoredValue][] = [];
      const deleteKeys: string[] = [];
      for (const [key, value] of txn.copies.entries()) {
        if (value) putEntries.push([key, value]);
        else deleteKeys.push(key);
      }
      if (putEntries.length > 0) await this.storage.putMany(putEntries);
      if (deleteKeys.length > 0) await this.storage.deleteMany(deleteKeys);

      const newTxnCount = finishTxnCount + 1;
      await this.setTxnCount(newTxnCount);
      await this.setTxnWriteSet(newTxnCount, txn.writeSet);
      // Keep txnWriteSets.size <= txnMapSize: deleted ID may be negative
      // (i.e. transaction never existed)
      await this.setTxnWriteSet(newTxnCount - txnMapSize, undefined);
      return true;
    });
  }

  async runTransaction<T>(
    closure: (txn: StorageTransaction) => Promise<T>
  ): Promise<T> {
    // TODO (someday): maybe throw exception after n retries?
    while (true) {
      const { txn, result } = await this.read(closure);
      if (await this.validateWrite(txn)) return result;
    }
  }
}
