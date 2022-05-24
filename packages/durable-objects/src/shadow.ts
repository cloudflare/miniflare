import assert from "assert";
import {
  Storage,
  StorageListOptions,
  StorageListResult,
  StoredKey,
  StoredValue,
  addAll,
} from "@miniflare/shared";
import { listFilterMatch } from "@miniflare/storage-memory";

const collator = new Intl.Collator();

export class ShadowStorage extends Storage {
  readonly readSet?: Set<string>;
  readonly copies = new Map<string, StoredValue | undefined>();
  alarm: number | null = null;

  constructor(protected readonly inner: Storage, recordReads = true) {
    super();
    if (recordReads) this.readSet = new Set<string>();
  }

  async has(key: string): Promise<boolean> {
    return (await this.hasMany([key])) > 0;
  }
  async hasMany(keys: string[]): Promise<number> {
    if (this.readSet) addAll(this.readSet, keys);
    // If no copies, pass through to inner
    if (this.copies.size === 0) return this.inner.hasMany(keys);

    let count = 0;
    // Keys to batch check in inner storage
    const innerHasKeys: string[] = [];
    for (const key of keys) {
      if (this.copies.has(key)) {
        // If key deleted, value is undefined, this shouldn't be counted
        if (this.copies.get(key) !== undefined) count++;
      } else {
        innerHasKeys.push(key);
      }
    }
    count += await this.inner.hasMany(innerHasKeys);
    return count;
  }

  async get(key: string): Promise<StoredValue | undefined> {
    return (await this.getMany([key]))[0];
  }
  async getMany(keys: string[]): Promise<(StoredValue | undefined)[]> {
    if (this.readSet) addAll(this.readSet, keys);
    // If no copies, pass through to inner
    if (this.copies.size === 0) return this.inner.getMany(keys, true);

    const result = new Array<StoredValue | undefined>(keys.length);
    // Keys and indices of keys to batch get from inner storage
    const innerGetKeys: string[] = [];
    const innerGetIndices: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (this.copies.has(key)) {
        // Value may be undefined if key deleted so need explicit has
        const copy = this.copies.get(key);
        // Return fresh copy so caller can mutate without affecting stored
        result[i] = copy && { value: copy.value.slice() };
      } else {
        innerGetKeys.push(key);
        innerGetIndices.push(i);
      }
    }

    assert.strictEqual(innerGetKeys.length, innerGetIndices.length);
    // If we managed to get all keys from copies, don't batch get from storage
    if (innerGetKeys.length === 0) return result;

    // Batch get keys from storage
    const innerGetResult = await this.inner.getMany(innerGetKeys, true);
    assert.strictEqual(innerGetKeys.length, innerGetResult.length);
    for (let i = 0; i < innerGetKeys.length; i++) {
      result[innerGetIndices[i]] = innerGetResult[i];
    }
    return result;
  }

  put(key: string, value: StoredValue): void {
    // Store fresh copy so further mutations from caller aren't stored
    this.copies.set(key, { value: value.value.slice() });
  }

  async delete(key: string): Promise<boolean> {
    return (await this.deleteMany([key])) > 0;
  }
  async deleteMany(keys: string[]): Promise<number> {
    const deleted = await this.hasMany(keys);
    for (const key of keys) this.copies.set(key, undefined);
    return deleted;
  }

  async list(
    options?: Omit<StorageListOptions, "cursor" /* unsupported */>
  ): Promise<StorageListResult<StoredKey>> {
    // If no copies, pass through to inner
    if (this.copies.size === 0) {
      const { keys } = await this.inner.list(options, true as any);
      if (this.readSet) {
        addAll(
          this.readSet,
          keys.map(({ name }) => name)
        );
      }
      return { keys, cursor: "" /* unsupported */ };
    }

    // Find all shadow copies matching list options and the number of these that
    // were deleted
    const matchingCopies = new Map<string, StoredValue | undefined>();
    let deletedMatchingCopies = 0;
    for (const [key, value] of this.copies.entries()) {
      if (listFilterMatch(options, key)) {
        matchingCopies.set(key, value);
        if (value === undefined) deletedMatchingCopies++;
      }
    }

    // Perform list on inner storage
    let { keys } = await this.inner.list(
      {
        ...options,
        // If limiting, fetch enough extra keys to cover deleted values
        limit: options?.limit && options.limit + deletedMatchingCopies,
      },
      true
    );
    // Merge in shadow copies, filtering out deleted
    keys = keys.filter((stored) => {
      // Value may be undefined if key deleted so need explicit has
      if (matchingCopies.has(stored.name)) {
        const matching = matchingCopies.get(stored.name);
        // Make sure we don't add this entry again
        matchingCopies.delete(stored.name);
        // If deleted, remove from result...
        if (matching === undefined) return false;
      }
      // ...otherwise, keep it in
      return true;
    });
    // Add remaining (non-deleted) matching copies (newly added keys)
    for (const [key, value] of matchingCopies.entries()) {
      if (value) keys.push({ name: key });
    }

    // Reapply sort and limit
    const direction = options?.reverse ? -1 : 1;
    keys.sort((a, b) => direction * collator.compare(a.name, b.name));
    if (options?.limit) keys = keys.slice(0, options.limit);

    // Mark read keys as read and return
    if (this.readSet) {
      addAll(
        this.readSet,
        keys.map(({ name }) => name)
      );
    }
    return { keys, cursor: "" /* unsupported */ };
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = -1;
  }
}
