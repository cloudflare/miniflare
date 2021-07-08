export interface KVStoredValue<Value = Buffer> {
  value: Value;
  expiration?: number;
  metadata?: any;
}

export interface KVStoredKey {
  name: string;
  expiration?: number;
  metadata?: any;
}

export type KVStoredValueOnly = Pick<KVStoredValue, "value">;
export type KVStoredKeyOnly = Pick<KVStoredKey, "name">;

export interface KVStorageListOptions {
  // If this is true, metadata MAY NOT be included in the result. Note this is a
  // just a hint, the implementation may need to fetch metadata anyways.
  skipMetadata?: boolean;
  // Returned keys must start with this string if defined
  prefix?: string;
  // Arbitrary filter for keys, implementations may not fetch metadata until
  // after this step as an optimisation. Keys that do not match the prefix or
  // have expired should be filtered out prior to calling this function. This
  // function may also sort the keys. This order must be preserved in the return
  // of the list call.
  keysFilter?: (keys: KVStoredKey[]) => KVStoredKey[];
}

export abstract class KVStorage {
  // All functions should never returned expired keys
  abstract has(key: string): Promise<boolean>;
  abstract get(
    key: string,
    skipMetadata?: false
  ): Promise<KVStoredValue | undefined>;
  abstract get(
    key: string,
    skipMetadata: true
  ): Promise<KVStoredValueOnly | undefined>;
  abstract put(key: string, value: KVStoredValue): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
  abstract list(options?: KVStorageListOptions): Promise<KVStoredKey[]>;

  // Batch functions, default implementations may be overridden to optimise
  async hasMany(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) if (await this.has(key)) count++;
    return count;
  }
  getMany(
    keys: string[],
    skipMetadata?: false
  ): Promise<(KVStoredValue | undefined)[]>;
  getMany(
    keys: string[],
    skipMetadata: true
  ): Promise<(KVStoredValueOnly | undefined)[]>;
  async getMany(
    keys: string[],
    skipMetadata?: boolean
  ): Promise<(KVStoredValue | undefined)[]> {
    const values: (KVStoredValue | undefined)[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      values[i] = await this.get(keys[i], skipMetadata as any);
    }
    return values;
  }
  async putMany(data: [key: string, value: KVStoredValue][]): Promise<void> {
    for (const [key, value] of data) await this.put(key, value);
  }
  async deleteMany(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) if (await this.delete(key)) count++;
    return count;
  }
}
