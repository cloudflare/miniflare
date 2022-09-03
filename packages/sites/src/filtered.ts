import {
  InternalKVNamespaceOptions,
  KVGetOptions,
  KVGetValueType,
  KVListOptions,
  KVListResult,
  KVNamespace,
  KVPutOptions,
  KVPutValueType,
  KVValue,
  KVValueMeta,
} from "@miniflare/kv";
import { Matcher, Storage } from "@miniflare/shared";

export interface KeyMapper {
  lookup(key: string): string;
  reverseLookup(key: string): string;
}

export interface FilteredKVStorageNamespaceOptions {
  readOnly?: boolean;
  map?: KeyMapper;
  include?: Matcher;
  exclude?: Matcher;
}

export class FilteredKVNamespace extends KVNamespace {
  readonly #options: FilteredKVStorageNamespaceOptions;

  constructor(
    storage: Storage,
    options: FilteredKVStorageNamespaceOptions = {},
    internalOptions?: InternalKVNamespaceOptions
  ) {
    super(storage, internalOptions);
    this.#options = options;
  }

  #included(key: string): boolean {
    const options = this.#options;
    if (options.include !== undefined) return options.include.test(key);
    if (options.exclude !== undefined) return !options.exclude.test(key);
    return true;
  }

  get(
    key: string,
    options?: KVGetValueType | Partial<KVGetOptions>
  ): KVValue<any> {
    key = this.#options.map?.lookup(key) ?? key;
    if (!this.#included(key)) return Promise.resolve(null);
    return super.get(key, options as any);
  }

  getWithMetadata<Meta = unknown>(
    key: string,
    options?: KVGetValueType | Partial<KVGetOptions>
  ): KVValueMeta<any, Meta> {
    key = this.#options.map?.lookup(key) ?? key;
    if (!this.#included(key)) {
      return Promise.resolve({ value: null, metadata: null });
    }
    return super.getWithMetadata(key, options as any);
  }

  async put(
    key: string,
    value: KVPutValueType,
    options?: KVPutOptions
  ): Promise<void> {
    if (this.#options.readOnly) {
      throw new TypeError("Unable to put into read-only namespace");
    }
    key = this.#options.map?.lookup(key) ?? key;
    return super.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    if (this.#options.readOnly) {
      throw new TypeError("Unable to delete from read-only namespace");
    }
    key = this.#options.map?.lookup(key) ?? key;
    return super.delete(key);
  }

  async list<Meta = unknown>(
    options?: KVListOptions
  ): Promise<KVListResult<Meta>> {
    const { keys, list_complete, cursor } = await super.list<Meta>(options);
    return {
      keys: keys.filter((key) => {
        if (!this.#included(key.name)) return false;
        if (this.#options.map !== undefined) {
          key.name = this.#options.map.reverseLookup(key.name);
        }
        return true;
      }),
      list_complete,
      cursor,
    };
  }
}
