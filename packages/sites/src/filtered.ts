import {
  KVGetOptions,
  KVListOptions,
  KVListResult,
  KVNamespace,
  KVPutOptions,
  KVPutValueType,
  KVValue,
  KVValueMeta,
} from "@miniflare/kv";
import { Clock, Matcher, StorageOperator } from "@miniflare/shared";

export interface FilteredKVStorageNamespaceOptions {
  readOnly?: boolean;
  include?: Matcher;
  exclude?: Matcher;
}

const kOptions = Symbol("kOptions");
const kIncluded = Symbol("kIncluded");

export class FilteredKVNamespace extends KVNamespace {
  private readonly [kOptions]: FilteredKVStorageNamespaceOptions;

  constructor(
    storage: StorageOperator,
    options: FilteredKVStorageNamespaceOptions = {},
    clock?: Clock
  ) {
    super(storage, clock);
    this[kOptions] = options;
  }

  private [kIncluded](key: string): boolean {
    const options = this[kOptions];
    if (options.include !== undefined) return options.include.test(key);
    if (options.exclude !== undefined) return !options.exclude.test(key);
    return true;
  }

  get(key: string, options?: KVGetOptions): KVValue<any> {
    if (!this[kIncluded](key)) return Promise.resolve(null);
    return super.get(key, options as any);
  }

  getWithMetadata<Meta = unknown>(
    key: string,
    options?: KVGetOptions
  ): KVValueMeta<any, Meta> {
    if (!this[kIncluded](key)) {
      return Promise.resolve({ value: null, metadata: null });
    }
    return super.getWithMetadata(key, options as any);
  }

  async put(
    key: string,
    value: KVPutValueType,
    options?: KVPutOptions
  ): Promise<void> {
    if (this[kOptions].readOnly) {
      throw new TypeError("Unable to put into read-only namespace");
    }
    return super.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    if (this[kOptions].readOnly) {
      throw new TypeError("Unable to delete from read-only namespace");
    }
    return super.delete(key);
  }

  async list<Meta = unknown>(
    options?: KVListOptions
  ): Promise<KVListResult<Meta>> {
    const { keys, list_complete, cursor } = await super.list<Meta>(options);
    return {
      keys: keys.filter((key) => this[kIncluded](key.name)),
      list_complete,
      cursor,
    };
  }
}
