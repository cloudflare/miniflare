import { RangeStoredValueMeta, defaultClock } from "@miniflare/shared";
import { StoredKeyMeta, StoredMeta, StoredValueMeta } from "@miniflare/shared";
import { cloneMetadata } from "./helpers";
import { LocalStorage } from "./local";

export class MemoryStorage extends LocalStorage {
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
    offset?: number,
    length?: number,
    suffix?: number
  ): RangeStoredValueMeta<Meta> | undefined {
    // corner case: suffix below 0 returns undefined
    if (suffix !== undefined && suffix < 0) return;

    const stored = this.map.get(key);
    if (stored === undefined) return undefined;
    const { value } = stored;
    const size = value.length;
    // build proper offset and length
    if (suffix !== undefined) {
      offset = size - suffix;
      length = size - offset;
    }
    if (offset === undefined) offset = 0;
    if (length === undefined) length = size;

    // TODO: If offset is negative or offset + length goes past the end of the uint8array, create 0 padding
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
}
