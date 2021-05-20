import path from "path";
import sanitize from "sanitize-filename";
import { FileKVStorage, KVStorage, MemoryKVStorage } from "./storage";

export function sanitise(fileName: string): string {
  return sanitize(fileName, { replacement: "_" });
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
