import assert from "assert";
import { Storage, StorageFactory, StoredValueMeta } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";

export class StackedMemoryStorage extends MemoryStorage {
  private readonly stack: Map<string, StoredValueMeta>[] = [];
  private readonly transactionStack: string[] = [];

  push(): void {
    this.stack.push(this.map);
    this.map = new Map(this.map);

    if (this.sqliteDB) {
      const transactionName = `STACK_${this.transactionStack.length + 1}`;
      this.transactionStack.push(transactionName);

      this.sqliteDB.exec(`SAVEPOINT ${transactionName}`);
    }
  }

  pop(): void {
    // If the storage wasn't created immediately (e.g. caches.open(), Durable
    // Object instances), the stack may be popped more times than it's pushed.
    // If this happens, default to an empty map, since the storage didn't exist
    // at the new stack level.
    this.map = this.stack.pop() ?? new Map();

    if (this.sqliteDB) {
      const transactionToRollback = this.transactionStack.pop();
      // This may be undefined if we popped too many times
      if (transactionToRollback) {
        this.sqliteDB.exec(`ROLLBACK TO ${transactionToRollback}`);
        this.sqliteDB.exec(`RELEASE ${transactionToRollback}`);
      }
    }
  }
}

export class StackedMemoryStorageFactory implements StorageFactory {
  private readonly storages = new Map<string, StackedMemoryStorage>();

  storage(namespace: string, persist?: boolean | string): Storage {
    // Test environments don't support persistent storage
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
