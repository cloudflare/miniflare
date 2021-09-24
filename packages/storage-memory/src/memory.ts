import { Mutex, defaultClock } from "@miniflare/shared";
import {
  Storage,
  StorageTransaction,
  StoredKeyMeta,
  StoredMeta,
  StoredValueMeta,
} from "@miniflare/shared";
import { cloneMetadata } from "./helpers";
import { LocalStorageOperator } from "./local";
import { OptimisticTransactionManager } from "./transaction";

export class MemoryStorageOperator extends LocalStorageOperator {
  constructor(
    private readonly map = new Map<string, StoredValueMeta>(),
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
      MemoryStorageOperator.entryToStoredKey
    ) as StoredKeyMeta<Meta>[];
  }
}

export class MemoryTransactionManager extends OptimisticTransactionManager {
  private readonly mutex = new Mutex();
  private txnCount = 0;
  private txnWriteSets = new Map<number, Set<string>>();

  runExclusive<T>(closure: () => Promise<T>): Promise<T> {
    return this.mutex.runWith(closure);
  }

  getTxnCount(): number {
    return this.txnCount;
  }
  setTxnCount(value: number): void {
    this.txnCount = value;
  }

  getTxnWriteSet(id: number): Set<string> | undefined {
    return this.txnWriteSets.get(id);
  }
  setTxnWriteSet(id: number, value: Set<string> | undefined): void {
    if (value) this.txnWriteSets.set(id, value);
    else this.txnWriteSets.delete(id);
  }
}

export class MemoryStorage extends MemoryStorageOperator implements Storage {
  private readonly txnManager = new MemoryTransactionManager(this);

  transaction<T>(closure: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return this.txnManager.runTransaction(closure);
  }
}
