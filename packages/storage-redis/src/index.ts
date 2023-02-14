import assert from "assert";
import {
  Range,
  RangeStoredValue,
  RangeStoredValueMeta,
  Storage,
  StorageListOptions,
  StorageListResult,
  StoredKey,
  StoredKeyMeta,
  StoredMeta,
  StoredValue,
  StoredValueMeta,
  millisToSeconds,
  parseRange,
  viewToArray,
} from "@miniflare/shared";
import { listFilterMatch, listPaginate } from "@miniflare/storage-memory";
import { Commands, Pipeline } from "ioredis";

/** @internal */
export function _bufferFromArray(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export class RedisStorage extends Storage {
  readonly #redis: Commands;

  constructor(redis: Commands, protected readonly namespace: string) {
    super();
    this.#redis = redis;
  }

  // Store keys and metadata with different prefixes so scanning for keys only
  // returns one, and we can fetch metadata separately for listing
  readonly #key = (key: string): string => `${this.namespace}:value:${key}`;
  readonly #metaKey = (key: string): string => `${this.namespace}:meta:${key}`;

  // Throws any errors from the result of a pipeline
  // noinspection JSMethodCanBeStatic
  protected throwPipelineErrors(pipelineRes: [Error | null, unknown][]): void {
    for (const [error] of pipelineRes) if (error) throw error;
  }

  async has(key: string): Promise<boolean> {
    return (await this.#redis.exists(this.#key(key))) > 0;
  }
  async hasMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.#redis.exists(...keys.map(this.#key));
  }

  async head<Meta>(key: string): Promise<StoredMeta<Meta> | undefined> {
    const exists = await this.#redis.exists(this.#key(key));
    if (exists === 0) return undefined;

    // If we do, pipeline get the value, metadata and expiration TTL. Ideally,
    // we'd use EXPIRETIME here but it was only added in Redis 7 so support
    // wouldn't be great: https://redis.io/commands/expiretime
    const pipelineRes = await this.#redis
      .pipeline()
      .get(this.#metaKey(key))
      .pttl(this.#key(key))
      .exec();
    // Assert pipeline returned expected number of results successfully
    assert.strictEqual(pipelineRes.length, 2);
    this.throwPipelineErrors(pipelineRes);
    // Extract pipeline results
    const meta: string | null = pipelineRes[0][1];
    const ttl: number = pipelineRes[1][1];
    // Return result
    return {
      metadata: meta ? JSON.parse(meta) : undefined,
      // Used PTTL so ttl is in milliseconds, negative TTL means key didn't
      // exist or no expiration
      expiration: ttl >= 0 ? millisToSeconds(Date.now() + ttl) : undefined,
    };
  }

  get<Meta = unknown>(
    key: string,
    skipMetadata?: false
  ): Promise<StoredValueMeta<Meta> | undefined>;
  get(key: string, skipMetadata: true): Promise<StoredValue | undefined>;
  async get<Meta>(
    key: string,
    skipMetadata?: boolean
  ): Promise<StoredValueMeta<Meta> | undefined> {
    if (skipMetadata) {
      // If we don't need metadata, just get the value, Redis handles expiry
      const value = await this.#redis.getBuffer(this.#key(key));
      return value === null ? undefined : { value: viewToArray(value) };
    }

    // If we do, pipeline get the value, metadata and expiration TTL. Ideally,
    // we'd use EXPIRETIME here but it was only added in Redis 7 so support
    // wouldn't be great: https://redis.io/commands/expiretime
    const pipelineRes = await this.#redis
      .pipeline()
      .getBuffer(this.#key(key))
      .get(this.#metaKey(key))
      .pttl(this.#key(key))
      .exec();
    // Assert pipeline returned expected number of results successfully
    assert.strictEqual(pipelineRes.length, 3);
    this.throwPipelineErrors(pipelineRes);
    // Extract pipeline results
    const value: Buffer | null = pipelineRes[0][1];
    const meta: string | null = pipelineRes[1][1];
    const ttl: number = pipelineRes[2][1];
    // Return result
    if (value === null) return undefined;
    return {
      value: viewToArray(value),
      metadata: meta ? JSON.parse(meta) : undefined,
      // Used PTTL so ttl is in milliseconds, negative TTL means key didn't
      // exist or no expiration
      expiration: ttl >= 0 ? millisToSeconds(Date.now() + ttl) : undefined,
    };
  }
  getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: false
  ): Promise<(StoredValueMeta<Meta> | undefined)[]>;
  getMany(
    keys: string[],
    skipMetadata: true
  ): Promise<(StoredValue | undefined)[]>;
  async getMany<Meta = unknown>(
    keys: string[],
    skipMetadata?: boolean
  ): Promise<(StoredValueMeta<Meta> | undefined)[]> {
    if (keys.length === 0) return [];
    if (skipMetadata) {
      // If we don't need metadata, we can just get all the values, Redis will
      // handle expiry
      // @ts-expect-error mgetBuffer exists, it's just not in type definitions
      const values: (Buffer | null)[] = await this.#redis.mgetBuffer(
        ...keys.map(this.#key)
      );
      return values.map((value) =>
        value === null ? undefined : { value: viewToArray(value) }
      );
    }

    // If we do, pipeline getting the value, then getting metadata, then
    // getting all expiration TTLs. Note there's no MPTTL command. Again,
    // ideally we'd use EXPIRETIME here.
    const redisKeys = keys.map(this.#key);
    const redisMetaKeys = keys.map(this.#metaKey);
    let pipeline: Pipeline = this.#redis
      .pipeline()
      // @ts-expect-error mgetBuffer exists, it's just not in type definitions
      .mgetBuffer(...redisKeys)
      .mget(...redisMetaKeys);
    for (const redisKey of redisKeys) pipeline = pipeline.pttl(redisKey);
    const pipelineRes = await pipeline.exec();
    // Assert pipeline returned expected number of results successfully:
    // 2 (mgetBuffer + mget) + |keys| (pttl)
    assert.strictEqual(pipelineRes.length, 2 + keys.length);
    this.throwPipelineErrors(pipelineRes);
    // Extract pipeline results
    const values = pipelineRes[0][1];
    const metas = pipelineRes[1][1];
    // Should have value and meta for each key, even if null
    assert.strictEqual(values.length, keys.length);
    assert.strictEqual(metas.length, keys.length);
    // Return result
    const now = Date.now();
    const res: (StoredValueMeta<Meta> | undefined)[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      // Extract pipeline results
      // (`2 +` for ttl is for getting past mgetBuffer + mget)
      const value: Buffer | null = values[i];
      const meta: string | null = metas[i];
      const ttl: number = pipelineRes[2 + i][1];
      if (value === null) {
        res[i] = undefined;
      } else {
        res[i] = {
          value: viewToArray(value),
          metadata: meta ? JSON.parse(meta) : undefined,
          // Used PTTL so ttl is in milliseconds, negative TTL means key
          // didn't exist or no expiration
          expiration: ttl >= 0 ? millisToSeconds(now + ttl) : undefined,
        };
      }
    }
    return res;
  }

  getRange<Meta = unknown>(
    key: string,
    range?: Range,
    skipMetadata?: false
  ): Promise<RangeStoredValueMeta<Meta> | undefined>;
  getRange(
    key: string,
    range?: Range,
    skipMetadata?: true
  ): Promise<RangeStoredValue | undefined>;
  async getRange<Meta>(
    key: string,
    range: Range = {},
    skipMetadata?: boolean
  ): Promise<RangeStoredValueMeta<Meta> | undefined> {
    // ensure offset and length are prepared
    const size = await this.#redis.strlen(this.#key(key));
    if (size === 0) return undefined;
    const { offset, length } = parseRange(range, size);

    if (skipMetadata) {
      // If we don't need metadata, just get the value, Redis handles expiry
      const value = await this.#redis.getrangeBuffer(
        this.#key(key),
        offset,
        offset + length
      );
      return value.byteLength === 0
        ? undefined
        : {
            value: viewToArray(value),
            range: { offset, length },
          };
    }

    // If we do, pipeline get the value, metadata and expiration TTL. Ideally,
    // we'd use EXPIRETIME here but it was only added in Redis 7 so support
    // wouldn't be great: https://redis.io/commands/expiretime
    const pipelineRes = await this.#redis
      .pipeline()
      .getrangeBuffer(this.#key(key), offset, offset + length - 1)
      .get(this.#metaKey(key))
      .pttl(this.#key(key))
      .exec();
    // Assert pipeline returned expected number of results successfully
    assert.strictEqual(pipelineRes.length, 3);
    this.throwPipelineErrors(pipelineRes);
    // Extract pipeline results
    const value: Buffer | null = pipelineRes[0][1];
    const meta: string | null = pipelineRes[1][1];
    const ttl: number = pipelineRes[2][1];
    // Return result
    if (value === null) return undefined;
    return {
      value: viewToArray(value),
      metadata: meta ? JSON.parse(meta) : undefined,
      // Used PTTL so ttl is in milliseconds, negative TTL means key didn't
      // exist or no expiration
      expiration: ttl >= 0 ? millisToSeconds(Date.now() + ttl) : undefined,
      range: { offset, length },
    };
  }

  async put<Meta = unknown>(
    key: string,
    value: StoredValueMeta<Meta>
  ): Promise<void> {
    // May as well pipeline put as may need to set metadata too and reduces
    // code duplication
    await this.putMany([[key, value]]);
  }
  async putMany<Meta = unknown>(
    data: [key: string, value: StoredValueMeta<Meta>][]
  ): Promise<void> {
    let pipeline = this.#redis.pipeline();
    // PX expiry mode is millisecond TTL. Ideally, we'd use EXAT as the mode
    // here instead, but it was added in Redis 6.2 so support wouldn't be great:
    // https://redis.io/commands/set#history
    const now = Date.now();
    for (const [key, { value, expiration, metadata }] of data) {
      const redisKey = this.#key(key);
      const buffer = _bufferFromArray(value);
      // Work out millisecond TTL if defined (there are probably some rounding
      // errors here, but we'll only be off by a second so it's hopefully ok)
      const ttl =
        expiration === undefined ? undefined : expiration * 1000 - now;
      if (ttl === undefined) {
        pipeline = pipeline.set(redisKey, buffer);
      } else {
        pipeline = pipeline.set(redisKey, buffer, "PX", ttl);
      }
      if (metadata) {
        // Only store metadata if defined
        const redisMetaKey = this.#metaKey(key);
        const json = JSON.stringify(metadata);
        if (ttl === undefined) {
          pipeline = pipeline.set(redisMetaKey, json);
        } else {
          pipeline = pipeline.set(redisMetaKey, json, "PX", ttl);
        }
      }
    }
    // Assert pipeline completed successfully
    const pipelineRes = await pipeline.exec();
    this.throwPipelineErrors(pipelineRes);
  }

  async delete(key: string): Promise<boolean> {
    // Delete the key and associated metadata
    const deleted = await this.#redis.del(this.#key(key), this.#metaKey(key));
    // If we managed to delete a key, return true (we shouldn't ever be able
    // to delete just the metadata)
    return deleted > 0;
  }
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    // Delete the keys and their associated metadata. Do this separately so we
    // can work out the number of actual keys we deleted, as not all keys will
    // have metadata.
    const pipeline = this.#redis
      .pipeline()
      .del(...keys.map(this.#key))
      .del(...keys.map(this.#metaKey));
    const pipelineRes = await pipeline.exec();
    // Assert pipeline returned expected number of results successfully
    assert.strictEqual(pipelineRes.length, 2);
    this.throwPipelineErrors(pipelineRes);
    // Return number of real keys deleted
    return pipelineRes[0][1];
  }

  list<Meta = unknown>(
    options?: StorageListOptions,
    skipMetadata?: false
  ): Promise<StorageListResult<StoredKeyMeta<Meta>>>;
  list(
    options: StorageListOptions,
    skipMetadata: true
  ): Promise<StorageListResult<StoredKey>>;
  async list<Meta>(
    options?: StorageListOptions,
    skipMetadata?: boolean
  ): Promise<StorageListResult<StoredKeyMeta<Meta>>> {
    // Get the `NAMESPACE:value:` Redis key prefix so we can remove it
    const redisKeyPrefix = this.#key("");
    // Scan all keys matching the prefix. This is quite inefficient but it would
    // be difficult to encode all list options in a Redis scan.
    // TODO (someday): could maybe use a sorted set and ZRANGEBYLEX: https://redis.io/commands/zrangebylex
    const keys = await new Promise<StoredKeyMeta<Meta>[]>((resolve) => {
      const keys: StoredKeyMeta<Meta>[] = [];
      const stream = this.#redis.scanStream({
        // Always match the Redis key prefix, optionally match a user-specified
        // one too
        match: `${redisKeyPrefix}${options?.prefix ?? ""}*`,
        // TODO (someday): consider increasing page size a bit
      });
      stream.on("data", (page: string[]) => {
        for (const key of page) {
          // Remove the Redis key prefix from each scanned key
          const name = key.substring(redisKeyPrefix.length);
          // Apply start and end filter
          if (listFilterMatch(options, name)) keys.push({ name });
        }
      });
      // Resolve the promise once we've fetched all matching keys
      stream.on("end", () => resolve(keys));
    });

    // Apply sort, cursor, and limit
    const res = listPaginate(options, keys);
    // If we don't need metadata, return now and save fetching it all
    if (skipMetadata || res.keys.length === 0) return res;

    // Fetch the metadata for the remaining keys. Note that we're not fetching
    // metadata for all keys originally matching the prefix, just the ones we're
    // going to return from the list after the filter.
    const redisMetaKeys = res.keys.map(({ name }) => this.#metaKey(name));
    // Pipeline getting metadata and all expiration TTLs. Again, note there's no
    // MPTTL command and ideally we'd use EXPIRETIME here.
    let pipeline: Pipeline = this.#redis.pipeline().mget(...redisMetaKeys);
    for (const key of res.keys) pipeline = pipeline.pttl(this.#key(key.name));
    const pipelineRes = await pipeline.exec();
    // Assert pipeline returned expected number of results successfully:
    // 1 (mget) + |keys| (pttl)
    assert.strictEqual(pipelineRes.length, 1 + res.keys.length);
    this.throwPipelineErrors(pipelineRes);
    // Extract pipeline results
    const metas = pipelineRes[0][1];
    assert.strictEqual(metas.length, res.keys.length);
    // Populate keys with metadata and expiration
    const now = Date.now();
    for (let i = 0; i < res.keys.length; i++) {
      // Extract pipeline results (`1 +` for ttl is for getting past mget)
      const meta: string | null = metas[i];
      const ttl: number = pipelineRes[1 + i][1];
      res.keys[i].metadata = meta ? JSON.parse(meta) : undefined;
      // Used PTTL so ttl is in milliseconds, negative TTL means key
      // didn't exist or no expiration
      res.keys[i].expiration =
        ttl >= 0 ? millisToSeconds(now + ttl) : undefined;
    }
    return res;
  }
}
