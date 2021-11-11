import assert from "assert";
import { Storage, StorageFactory, StoredValueMeta } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";

export class StackedMemoryStorage extends MemoryStorage {
  private readonly stack: Map<string, StoredValueMeta>[] = [];

  push(): void {
    this.stack.push(this.map);
    this.map = new Map(this.map);
  }

  pop(): void {
    // If the storage wasn't created immediately (e.g. caches.open(), Durable
    // Object instances), the stack may be popped more times than it's pushed.
    // If this happens, default to an empty map, since the storage didn't exist
    // at the  new stack level.
    this.map = this.stack.pop() ?? new Map();
  }
}

export class StackedMemoryStorageFactory implements StorageFactory {
  private readonly storages = new Map<string, StackedMemoryStorage>();

  storage(namespace: string, persist?: boolean | string): Storage {
    // @miniflare/jest-environment-miniflare doesn't support persistent storage
    assert(!persist);
    let storage = this.storages.get(namespace);
    if (storage) return storage;
    this.storages.set(namespace, (storage = new StackedMemoryStorage()));
    return storage;
  }

  push(): void {
    for (const storage of this.storages.values()) storage.push();
  }

  pop(): void {
    for (const storage of this.storages.values()) storage.pop();
  }
}
