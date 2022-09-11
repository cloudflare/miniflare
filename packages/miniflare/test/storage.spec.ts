import fs from "fs/promises";
import path from "path";
import { useTmp, utf8Decode, utf8Encode } from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import test from "ava";
import type IORedis from "ioredis";
import { VariedStorageFactory } from "miniflare";

test("VariedStorageFactory: creates and reuses in-memory-storage", async (t) => {
  const memoryStorages = new Map<string, MemoryStorage>();
  const factory = new VariedStorageFactory(memoryStorages);

  const storage = factory.storage("ns");
  t.true(memoryStorages.has("ns"));
  await storage.put("key", { value: utf8Encode("memory") });

  const storage2 = factory.storage("ns");
  t.is(utf8Decode((await storage2.get("key"))?.value), "memory");
});

class TestRedis {
  constructor(private readonly map: Record<string, Buffer>) {}

  getBuffer(key: string) {
    return this.map[key];
  }
}

test("VariedStorageFactory: creates redis storage", async (t) => {
  const redisUrl = "redis://mystery";
  const redisConnections = new Map<string, IORedis.Redis>();
  // @ts-expect-error we just want something with a similar signature
  const redisConnection: IORedis.Redis = new TestRedis({
    ["ns:value:key"]: Buffer.from("redis", "utf8"),
  });
  redisConnections.set("redis://mystery", redisConnection);

  const factory = new VariedStorageFactory(undefined, redisConnections);
  const storage = factory.storage("ns", redisUrl);
  t.is(utf8Decode((await storage.get("key", true))?.value), "redis");
});

test("VariedStorageFactory: creates file storage with sanitised namespace", async (t) => {
  const tmp = await useTmp(t);

  const factory = new VariedStorageFactory();
  const storage = factory.storage("a:b<ns>/c\\d", tmp);
  await storage.put("key", { value: utf8Encode("file") });

  t.is(
    await fs.readFile(path.join(tmp, "a", "b_ns_", "c", "d", "key"), "utf8"),
    "file"
  );
});
