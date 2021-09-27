import assert from "assert";
import { Storage, StorageFactory, StoredValueMeta } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";

export class MemoryStorageFactory extends StorageFactory {
  private readonly storages = new Map<string, MemoryStorage>();

  constructor(
    private readonly persist: Record<string, Map<string, StoredValueMeta>> = {}
  ) {
    super();
  }

  storage(namespace: string, persist?: boolean | string): Storage {
    let storage = this.storages.get(namespace);
    if (!storage) {
      assert(typeof persist !== "boolean");
      const map =
        persist === undefined
          ? undefined
          : this.persist[`${persist}:${namespace}`];
      this.storages.set(namespace, (storage = new MemoryStorage(map)));
    }
    return storage;
  }
}
