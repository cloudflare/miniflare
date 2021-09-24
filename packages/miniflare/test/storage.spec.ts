import { promises as fs } from "fs";
import path from "path";
import { MemoryStorage } from "@miniflare/storage-memory";
import { RedisPool } from "@miniflare/storage-redis";
import test from "ava";
import { VariedStorageFactory } from "miniflare";
import { useTmp, utf8Decode, utf8Encode } from "test:@miniflare/shared";

test("VariedStorageFactory: creates and reuses in-memory-storage", async (t) => {
  const memoryStorages = new Map<string, MemoryStorage>();
  const factory = new VariedStorageFactory(memoryStorages);

  const storage = await factory.storage("ns");
  t.true(memoryStorages.has("ns"));
  await storage.put("key", { value: utf8Encode("memory") });

  const storage2 = await factory.storage("ns");
  t.is(utf8Decode((await storage2.get("key"))?.value), "memory");
});

class TestRedisPool {
  constructor(private readonly map: Record<string, Buffer>) {}

  readonly shared = { getBuffer: (key: string) => this.map[key] };
}

test("VariedStorageFactory: creates redis storage", async (t) => {
  const redisUrl = "redis://mystery";
  const redisPools = new Map<string, RedisPool>();
  // @ts-expect-error we just want something with a similar signature
  const redisPool: RedisPool = new TestRedisPool({
    ["ns:value:key"]: Buffer.from("redis", "utf8"),
  });
  redisPools.set("redis://mystery", redisPool);

  const factory = new VariedStorageFactory(undefined, redisPools);
  const storage = await factory.storage("ns", redisUrl);
  t.is(utf8Decode((await storage.get("key", true))?.value), "redis");
});

test("VariedStorageFactory: creates file storage with sanitised namespace", async (t) => {
  const tmp = await useTmp(t);

  const factory = new VariedStorageFactory();
  const storage = await factory.storage("a:b<ns>/c\\d", tmp);
  await storage.put("key", { value: utf8Encode("file") });

  t.is(
    await fs.readFile(path.join(tmp, "a", "b_ns_", "c", "d", "key"), "utf8"),
    "file"
  );
});
