import assert from "assert";
import path from "path";
import sanitize from "sanitize-filename";
import { FileKVStorage, KVStorage, MemoryKVStorage } from "./storage";

export function sanitise(fileName: string): string {
  return sanitize(fileName, { replacement: "_" });
}

export function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

export class KVStorageFactory {
  constructor(
    private defaultPersistRoot: string,
    // Store memory KV storages for persistence across options reloads
    private memoryStorages: Map<string, MemoryKVStorage> = new Map()
  ) {}

  getStorage(namespace: string, persist?: boolean | string): KVStorage {
    // Handle boolean persist by setting persist to defaultPersistRoot if it's
    // true, or undefined if it's false
    persist = persist === true ? this.defaultPersistRoot : persist || undefined;
    if (persist) {
      // If the persist option is set, use file-system storage
      const root = path.join(persist, sanitise(namespace));
      return new FileKVStorage(root);
    } else {
      // Otherwise, use in-memory storage
      let storage = this.memoryStorages.get(namespace);
      if (storage) return storage;
      this.memoryStorages.set(namespace, (storage = new MemoryKVStorage()));
      return storage;
    }
  }
}

export class Mutex {
  private _locked = false;
  private _resolveQueue: (() => void)[] = [];

  private lock(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this._resolveQueue.push(resolve));
  }

  private unlock(): void {
    assert(this._locked);
    if (this._resolveQueue.length > 0) {
      this._resolveQueue.shift()?.();
    } else {
      this._locked = false;
    }
  }

  async run<T>(closure: () => Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await closure();
    } finally {
      this.unlock();
    }
  }
}
