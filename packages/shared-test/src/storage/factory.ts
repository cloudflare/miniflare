import assert from "assert";
import { Storage, StorageFactory, StoredValueMeta } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";

export class MemoryStorageFactory implements StorageFactory {
  readonly storages = new Map<string, MemoryStorage>();

  constructor(
    private readonly persist: Record<string, Map<string, StoredValueMeta>> = {}
  ) {}

  storage(namespace: string, persist?: boolean | string): Storage {
    assert(typeof persist !== "boolean");
    const key = persist ? `${persist}:${namespace}` : namespace;
    let storage = this.storages.get(key);
    if (!storage) {
      this.storages.set(key, (storage = new MemoryStorage(this.persist[key])));
    }
    return storage;
  }
}
