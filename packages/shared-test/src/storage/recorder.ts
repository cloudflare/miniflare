import {
  Awaitable,
  Storage,
  StorageListOptions,
  StorageListResult,
  StoredKeyMeta,
  StoredValueMeta,
} from "@miniflare/shared";

export type StorageEvent =
  | { type: "has"; key: string }
  | { type: "get"; key: string }
  | { type: "put"; key: string }
  | { type: "delete"; key: string }
  | { type: "list" }
  | { type: "hasMany"; keys: string[] }
  | { type: "getMany"; keys: string[] }
  | { type: "putMany"; keys: string[] }
  | { type: "deleteMany"; keys: string[] }
  | { type: "getAlarm" }
  | { type: "setAlarm" }
  | { type: "deleteAlarm" };

export class RecorderStorage extends Storage {
  events: StorageEvent[] = [];

  constructor(private readonly inner: Storage) {
    super();
  }

  has(key: string): Awaitable<boolean> {
    this.events.push({ type: "has", key });
    return this.inner.has(key);
  }

  get<Meta = unknown>(
    key: string,
    skipMetadata?: boolean
  ): Awaitable<StoredValueMeta<Meta> | undefined> {
    this.events.push({ type: "get", key });
    return this.inner.get(key, skipMetadata as any);
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

  getAlarm(): Awaitable<number | null> {
    this.events.push({ type: "getAlarm" });
    return this.inner.getAlarm();
  }

  setAlarm(value: number): Awaitable<void> {
    this.events.push({ type: "setAlarm" });
    return this.inner.setAlarm(value);
  }

  deleteAlarm(): Awaitable<void> {
    this.events.push({ type: "deleteAlarm" });
    return this.inner.deleteAlarm();
  }
}
