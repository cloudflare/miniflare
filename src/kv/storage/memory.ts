import { KVClock, defaultClock, millisToSeconds } from "../helpers";
import {
  KVStorage,
  KVStorageListOptions,
  KVStoredKey,
  KVStoredValue,
} from "./storage";

export class MemoryKVStorage extends KVStorage {
  constructor(
    private map = new Map<string, KVStoredValue>(),
    private clock: KVClock = defaultClock
  ) {
    super();
  }

  private expired(key: string, meta?: KVStoredValue, time?: number): boolean {
    if (meta === undefined) meta = this.map.get(key);
    if (time === undefined) time = millisToSeconds(this.clock());
    if (meta?.expiration !== undefined && meta.expiration <= time) {
      this.map.delete(key);
      return true;
    }
    return false;
  }

  async has(key: string): Promise<boolean> {
    if (this.expired(key)) return false;
    return this.map.has(key);
  }

  async get(key: string): Promise<KVStoredValue | undefined> {
    const value = this.map.get(key);
    if (this.expired(key, value)) return undefined;
    return value;
  }

  async put(key: string, value: KVStoredValue): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    if (this.expired(key)) return false;
    return this.map.delete(key);
  }

  async list({ prefix, keysFilter }: KVStorageListOptions = {}): Promise<
    KVStoredKey[]
  > {
    const time = millisToSeconds(this.clock());
    const keys = Array.from(this.map.entries())
      .filter(([name, value]) => {
        if (prefix !== undefined && !name.startsWith(prefix)) return false;
        return !this.expired(name, value, time);
      })
      .map<KVStoredKey>(([name, { expiration, metadata }]) => ({
        name,
        expiration,
        metadata,
      }));
    return keysFilter ? keysFilter(keys) : keys;
  }
}
