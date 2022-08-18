import {
  Awaitable,
  Range,
  RangeStoredValueMeta,
  Storage,
  StorageListOptions,
  StorageListResult,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
} from "@miniflare/shared";

export type StorageEvent =
  | { type: "has"; key: string }
  | { type: "head"; key: string }
  | { type: "get"; key: string }
  | { type: "getRange"; key: string }
  | { type: "put"; key: string }
  | { type: "delete"; key: string }
  | { type: "list" }
  | { type: "hasMany"; keys: string[] }
  | { type: "getMany"; keys: string[] }
  | { type: "putMany"; keys: string[] }
  | { type: "deleteMany"; keys: string[] };

export class RecorderStorage extends Storage {
  events: StorageEvent[] = [];

  constructor(private readonly inner: Storage) {
    super();
  }

  has(key: string): Awaitable<boolean> {
    this.events.push({ type: "has", key });
    return this.inner.has(key);
  }

  head<Meta = unknown>(key: string): Awaitable<StoredMeta<Meta> | undefined> {
    this.events.push({ type: "head", key });
    return this.inner.head(key);
  }

  get<Meta = unknown>(
    key: string,
    skipMetadata?: boolean
  ): Awaitable<StoredValueMeta<Meta> | undefined> {
    this.events.push({ type: "get", key });
    return this.inner.get(key, skipMetadata as any);
  }

  getRange<Meta = unknown>(
    key: string,
    range: Range,
    skipMetadata?: boolean
  ): Awaitable<RangeStoredValueMeta<Meta> | undefined> {
    this.events.push({ type: "getRange", key });
    return this.inner.getRange(key, range, skipMetadata as any);
  }

  put<Meta = unknown>(
    key: string,
    value: StoredValueMeta<Meta>
  ): Awaitable<void> {
    this.events.push({ type: "put", key });
    return this.inner.put(key, value);
  }

  delete(key: string): Awaitable<boolean> {
    this.events.push({ type: "delete", key });
    return this.inner.delete(key);
  }

  list<Meta = unknown>(
    options?: StorageListOptions,
    skipMetadata?: boolean
  ): Awaitable<StorageListResult<StoredKeyMeta<Meta>>> {
    this.events.push({ type: "list" });
    return this.inner.list(options, skipMetadata as any);
  }

  async hasMany(keys: string[]): Promise<number> {
    this.events.push({ type: "hasMany", keys });
    return this.inner.hasMany(keys);
  }

  getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: boolean
  ): Promise<(StoredValueMeta<Meta> | undefined)[]> {
    this.events.push({ type: "getMany", keys });
    return this.inner.getMany(keys, skipMetadata as any);
  }

  async putMany<Meta = unknown>(
    data: [key: string, value: StoredValueMeta<Meta>][]
  ): Promise<void> {
    this.events.push({ type: "putMany", keys: data.map(([name]) => name) });
    return this.inner.putMany(data);
  }

  async deleteMany(keys: string[]): Promise<number> {
    this.events.push({ type: "deleteMany", keys });
    return this.inner.deleteMany(keys);
  }
}
