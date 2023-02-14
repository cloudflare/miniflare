import {
  Range,
  RangeStoredValueMeta,
  SqliteDB,
  createSQLiteDB,
  defaultClock,
  parseRange,
} from "@miniflare/shared";
import { StoredKeyMeta, StoredMeta, StoredValueMeta } from "@miniflare/shared";
import { cloneMetadata } from "./helpers";
import { LocalStorage } from "./local";

export class MemoryStorage extends LocalStorage {
  protected sqliteDB?: SqliteDB;

  constructor(
    protected map = new Map<string, StoredValueMeta>(),
    clock = defaultClock
  ) {
    super(clock);
  }

  hasMaybeExpired(key: string): StoredMeta | undefined {
    const stored = this.map.get(key);
    // Return fresh copy so caller can mutate without affecting stored
    return (
      stored && {
        expiration: stored.expiration,
        metadata: cloneMetadata(stored.metadata),
      }
    );
  }

  headMaybeExpired<Meta>(key: string): StoredMeta<Meta> | undefined {
    const stored = this.map.get(key);
    return (
      stored && {
        expiration: stored.expiration,
        metadata: cloneMetadata(stored.metadata),
      }
    );
  }

  getMaybeExpired<Meta>(key: string): StoredValueMeta<Meta> | undefined {
    const stored = this.map.get(key);
    // Return fresh copy so caller can mutate without affecting stored
    return (
      stored && {
        value: stored.value.slice(),
        expiration: stored.expiration,
        metadata: cloneMetadata(stored.metadata),
      }
    );
  }

  getRangeMaybeExpired<Meta>(
    key: string,
    range: Range
  ): RangeStoredValueMeta<Meta> | undefined {
    const stored = this.map.get(key);
    if (stored === undefined) return;
    const { value } = stored;
    const size = value.byteLength;
    const { offset, length } = parseRange(range, size);

    return {
      value: value.slice(offset, offset + length),
      expiration: stored.expiration,
      metadata: cloneMetadata(stored.metadata),
      range: {
        offset,
        length,
      },
    };
  }

  put<Meta = unknown>(key: string, value: StoredValueMeta<Meta>): void {
    // Store fresh copy so further mutations from caller aren't stored
    this.map.set(key, {
      value: value.value.slice(),
      expiration: value.expiration,
      metadata: cloneMetadata(value.metadata),
    });
  }

  deleteMaybeExpired(key: string): boolean {
    return this.map.delete(key);
  }

  private static entryToStoredKey([name, { expiration, metadata }]: [
    string,
    StoredValueMeta
  ]): StoredKeyMeta {
    // Return fresh copy so caller can mutate without affecting stored
    return {
      name,
      expiration,
      metadata: cloneMetadata(metadata),
    };
  }

  listAllMaybeExpired<Meta>(): StoredKeyMeta<Meta>[] {
    return Array.from(this.map.entries()).map(
      MemoryStorage.entryToStoredKey
    ) as StoredKeyMeta<Meta>[];
  }

  async getSqliteDatabase(): Promise<SqliteDB> {
    if (this.sqliteDB) return this.sqliteDB;

    this.sqliteDB = await createSQLiteDB(":memory:");
    return this.sqliteDB;
  }
}
