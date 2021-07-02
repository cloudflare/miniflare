import { KVStorage, KVStoredKey, KVStoredValue } from "./storage";

export class MemoryKVStorage implements KVStorage {
  constructor(private map = new Map<string, KVStoredValue>()) {}

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async get(key: string): Promise<KVStoredValue | undefined> {
    return this.map.get(key);
  }

  async put(key: string, value: KVStoredValue): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list(): Promise<KVStoredKey[]> {
    return Array.from(this.map.entries()).map<KVStoredKey>(
      ([name, { expiration, metadata }]) => ({
        name,
        expiration,
        metadata,
      })
    );
  }
}
