import assert from "assert";
import path from "path";
import { Storage, StorageFactory, sanitisePath } from "@miniflare/shared";
import type { MemoryStorage } from "@miniflare/storage-memory";
import type { RedisPool } from "@miniflare/storage-redis";

const redisConnectionStringRegexp = /^rediss?:\/\//;

export class VariedStorageFactory extends StorageFactory {
  constructor(
    private readonly memoryStorages = new Map<string, MemoryStorage>(),
    private readonly redisPools = new Map<string, RedisPool>()
  ) {
    super();
  }

  // TODO: override operator for storage-kv-remote

  async storage(
    namespace: string,
    persist?: boolean | string
  ): Promise<Storage> {
    // boolean transformed by PluginStorageFactory
    assert(typeof persist !== "boolean");

    // If not persisting, use in-memory storage, caching these so data
    // persists between reloads
    if (persist === undefined) {
      let storage = this.memoryStorages.get(namespace);
      if (storage) return storage;
      const { MemoryStorage } = await import("@miniflare/storage-memory");
      this.memoryStorages.set(namespace, (storage = new MemoryStorage()));
      return storage;
    }

    // If the persist option is a redis connection string, use Redis storage,
    // caching connections so we can reuse them
    if (redisConnectionStringRegexp.test(persist)) {
      // TODO: display nicer error if @miniflare/storage-redis not installed
      const { RedisPool, RedisStorage } = await import(
        "@miniflare/storage-redis"
      );
      let pool = this.redisPools.get(persist);
      if (!pool) this.redisPools.set(persist, (pool = new RedisPool(persist)));
      return new RedisStorage(pool, namespace);
    }

    // Otherwise, use file-system storage
    const root = path.join(persist, sanitisePath(namespace));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FileStorage } = await import("@miniflare/storage-file");
    return new FileStorage(root);
  }
}
