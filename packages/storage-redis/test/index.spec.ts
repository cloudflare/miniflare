import assert from "assert";
import { Storage, StoredValueMeta, sanitisePath } from "@miniflare/shared";
import {
  RedisPool,
  RedisStorage,
  bufferFromArray,
} from "@miniflare/storage-redis";
import test, { ExecutionContext } from "ava";
import { randomHex } from "test:@miniflare/shared";
import {
  TIME_EXPIRED,
  TIME_EXPIRING,
  TestStorageFactory,
  operatorMacros,
  txnMacros,
} from "test:@miniflare/storage-memory";

// Only test Redis if a server URL has been set
// (WARNING: database will be flushed)
const redisUrl = process.env.MINIFLARE_TEST_REDIS_URL;
// Tests will run in isolated namespaces, so can run in parallel
const redisTest = redisUrl ? test.serial : test.skip;
const redis = redisUrl ? new RedisPool(redisUrl) : undefined;

test.before(async () => {
  await redis?.shared.flushdb();
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
      await redis.shared.setBuffer(redisKey, bufferFromArray(value));
      if (ttl !== undefined) await redis.shared.expire(redisKey, ttl);
      if (metadata) {
        const redisMetaKey = `${ns}:meta:${key}`;
        await redis.shared.set(redisMetaKey, JSON.stringify(metadata));
        if (ttl !== undefined) await redis.shared.expire(redisMetaKey, ttl);
      }
    }
    return new RedisStorage(redis, ns);
  }
}

const storageFactory = new RedisStorageFactory();
const transactionOperatorFactory = storageFactory.transactionOperatorFactory();

for (const macro of operatorMacros) {
  redisTest(macro, storageFactory);
  redisTest(macro, transactionOperatorFactory);
}
for (const macro of txnMacros) {
  redisTest(macro, storageFactory);
}
