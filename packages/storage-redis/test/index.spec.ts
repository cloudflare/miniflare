import assert from "assert";
import {
  Storage,
  StoredValueMeta,
  randomHex,
  sanitisePath,
} from "@miniflare/shared";
import {
  TIME_EXPIRED,
  TIME_EXPIRING,
  TestStorageFactory,
  storageMacros,
} from "@miniflare/shared-test";
import { RedisStorage, _bufferFromArray } from "@miniflare/storage-redis";
import test, { ExecutionContext } from "ava";
import IORedis from "ioredis";

// Only test Redis if a server URL has been set
// (WARNING: database will be flushed)
const redisUrl = process.env.MINIFLARE_TEST_REDIS_URL;
// Tests will run in isolated namespaces, so can run in parallel
const redisTest = redisUrl ? test.serial : test.skip;
const redis = redisUrl ? new IORedis(redisUrl) : undefined;

test.before(async () => {
  await redis?.flushdb();
});

class RedisStorageFactory extends TestStorageFactory {
  name = "RedisStorage";
  usesActualTime = true;
  usesSkipMetadata = true;

  async factory(
    t: ExecutionContext,
    seed: Record<string, StoredValueMeta>
  ): Promise<Storage> {
    assert(redis);
    const ns = `${sanitisePath(t.title)}/${randomHex()}`;
    for (const [key, { value, expiration, metadata }] of Object.entries(seed)) {
      let ttl: number | undefined = undefined;
      if (expiration === TIME_EXPIRED) ttl = 0;
      else if (expiration === TIME_EXPIRING) ttl = 3600;
      else if (expiration !== undefined) assert.fail();

      const redisKey = `${ns}:value:${key}`;
      await redis.setBuffer(redisKey, _bufferFromArray(value));
      if (ttl !== undefined) await redis.expire(redisKey, ttl);
      if (metadata) {
        const redisMetaKey = `${ns}:meta:${key}`;
        await redis.set(redisMetaKey, JSON.stringify(metadata));
        if (ttl !== undefined) await redis.expire(redisMetaKey, ttl);
      }
    }
    return new RedisStorage(redis, ns);
  }
}

const storageFactory = new RedisStorageFactory();
for (const macro of storageMacros) {
  redisTest(macro, storageFactory);
}
