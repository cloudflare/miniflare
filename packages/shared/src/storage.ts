import { Awaitable } from "./sync";

export interface StoredMeta<Meta = unknown> {
  /** Unix timestamp in seconds when this key expires */
  expiration?: number;
  /** Arbitrary JSON-serializable object */
  metadata?: Meta;
}
export interface RangeStoredMeta<Meta = unknown> extends StoredMeta<Meta> {
  range: {
    offset: number;
    length: number;
  };
}

export interface StoredValue {
  value: Uint8Array;
}
export interface RangeStoredValue extends StoredValue {
  range: {
    offset: number;
    length: number;
  };
}
export interface StoredKey {
  name: string;
}

export type StoredValueMeta<Meta = unknown> = StoredValue & StoredMeta<Meta>;
export type RangeStoredValueMeta<Meta = unknown> = RangeStoredValue &
  RangeStoredMeta<Meta>;
export type StoredKeyMeta<Meta = unknown> = StoredKey & StoredMeta<Meta>;

export interface Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

export interface StorageListOptions {
  // Stage 1: filtering
  /** Returned keys must start with this string if defined */
  prefix?: string;
  /** Returned keys must be lexicographically >= this string if defined */
  start?: string;
  /** Returned keys must be lexicographically < this string if defined */
  end?: string;

  // Stage 2: sorting
  /** Return keys in reverse order, MUST be applied before the limit/cursor */
  reverse?: boolean;

  // Stage 3: paginating
  // Motivation for cursor: we want to make sure if keys are added whilst we're
  // paginating, they're returned. We could do this by setting `start` to the
  // cursor, adding 1 to the limit, and removing the first key if it matches.
  // However, this only works if we can increase the limit, which isn't the case
  // for remote KV storage. Even with this, we'd still need to return an extra
  // pointer from the list result so we knew if there were still more keys. This
  // also lets other databases use their own cursors if supported.
  /** Cursor for pagination, undefined/empty-string means start at beginning */
  cursor?: string;
  /** Maximum number of keys to return if defined */
  limit?: number;

  // Stage 4: filtering
  /** If Delimiter, filter all keys containing delimiter and update cursor */
  delimiter?: string;
}
export interface StorageListResult<Key extends StoredKey = StoredKeyMeta> {
  keys: Key[];
  /** Cursor for next page */
  cursor: string;
  /** DelimitedPrefixes if delimiter */
  delimitedPrefixes?: string[];
}

/**
 * Common class for key-value storage:
 * - Methods should always return fresh copies of data (safe to mutate returned)
 * - Methods shouldn't return expired keys
 */
export abstract class Storage {
  abstract has(key: string): Awaitable<boolean>;
  abstract head<Meta = unknown>(
    key: string
  ): Awaitable<StoredMeta<Meta> | undefined>;
  abstract get<Meta = unknown>(
    key: string,
    skipMetadata?: false
  ): Awaitable<StoredValueMeta<Meta> | undefined>;
  abstract get(
    key: string,
    skipMetadata: true
  ): Awaitable<StoredValue | undefined>;
  abstract getRange<Meta = unknown>(
    key: string,
    range?: Range,
    skipMetadata?: false
  ): Awaitable<RangeStoredValueMeta<Meta> | undefined>;
  abstract getRange(
    key: string,
    range: undefined | Range,
    skipMetadata: true
  ): Awaitable<RangeStoredValue | undefined>;
  abstract put<Meta = unknown>(
    key: string,
    value: StoredValueMeta<Meta>
  ): Awaitable<void>;
  abstract delete(key: string): Awaitable<boolean>;
  abstract list<Meta = unknown>(
    options?: StorageListOptions,
    skipMetadata?: false
  ): Awaitable<StorageListResult<StoredKeyMeta<Meta>>>;
  abstract list(
    options: StorageListOptions,
    skipMetadata: true
  ): Awaitable<StorageListResult<StoredKey>>;

  // Batch functions, default implementations may be overridden to optimise

  async hasMany(keys: string[]): Promise<number> {
    const results = keys.map(this.has.bind(this));
    let count = 0;
    for (const result of await Promise.all(results)) if (result) count++;
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
  getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: boolean
  ): Promise<(StoredValueMeta<Meta> | undefined)[]> {
    return Promise.all(
      keys.map((key) => this.get(key, skipMetadata as any))
    ) as Promise<(StoredValueMeta<Meta> | undefined)[]>;
  }

  async putMany<Meta = unknown>(
    data: [key: string, value: StoredValueMeta<Meta>][]
  ): Promise<void> {
    await Promise.all(data.map(([key, value]) => this.put(key, value)));
  }

  async deleteMany(keys: string[]): Promise<number> {
    const results = keys.map(this.delete.bind(this));
    let count = 0;
    for (const result of await Promise.all(results)) if (result) count++;
    return count;
  }
}

export interface StorageFactory {
  storage(namespace: string, persist?: boolean | string): Awaitable<Storage>;
  dispose?(): Awaitable<void>;
}
