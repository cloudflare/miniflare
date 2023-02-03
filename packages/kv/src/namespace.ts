import { arrayBuffer } from "stream/consumers";
import { ReadableStream } from "stream/web";
import { TextDecoder, TextEncoder } from "util";
import {
  Clock,
  Storage,
  StoredKeyMeta,
  assertInRequest,
  defaultClock,
  getRequestContext,
  millisToSeconds,
  viewToArray,
  viewToBuffer,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";

const MIN_CACHE_TTL = 60; /* 60s */
const MIN_EXPIRATION = -2147483648; /* Minimum signed 32-bit integer */
const MAX_EXPIRATION = 2147483647; /* Maximum signed 32-bit integer */
const MAX_LIST_KEYS = 1000;
const MAX_KEY_SIZE = 512; /* 512B */
const MAX_VALUE_SIZE = 25 * 1024 * 1024; /* 25MiB */
const MAX_METADATA_SIZE = 1024; /* 1KiB */

const keyTypeError = " on 'KvNamespace': parameter 1 is not of type 'string'.";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type KVValue<Value> = Promise<Value | null>;
export type KVValueMeta<Value, Meta> = Promise<{
  value: Value | null;
  metadata: Meta | null;
}>;

export type KVGetValueType = "text" | "json" | "arrayBuffer" | "stream";
export type KVGetOptions<Type extends KVGetValueType = KVGetValueType> = {
  type: Type;
  cacheTtl?: number;
};
const getValueTypes = new Set(["text", "json", "arrayBuffer", "stream"]);

export type KVPutValueType =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream;
export interface KVPutOptions<Meta = unknown> {
  expiration?: string | number;
  expirationTtl?: string | number;
  metadata?: Meta;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}
export interface KVListResult<Meta = unknown> {
  keys: StoredKeyMeta<Meta>[];
  cursor: string;
  list_complete: boolean;
}

type Method = "GET" | "PUT" | "DELETE";

function throwKVError(method: Method, status: number, message: string) {
  throw new Error(`KV ${method} failed: ${status} ${message}`);
}

function validateKey(method: Method, key: string): void {
  // Check key name is allowed
  if (key === "") throw new TypeError("Key name cannot be empty.");
  if (key === ".") throw new TypeError('"." is not allowed as a key name.');
  if (key === "..") throw new TypeError('".." is not allowed as a key name.');
  // Check key isn't too long
  const keyLength = encoder.encode(key).byteLength;
  if (keyLength > MAX_KEY_SIZE) {
    throwKVError(
      method,
      414,
      `UTF-8 encoded length of ${keyLength} exceeds key length limit of ${MAX_KEY_SIZE}.`
    );
  }
}

/**
 * Normalises type, ignoring cacheTtl as there is only one "edge location":
 * the user's computer
 */
function validateGetOptions(
  options?: KVGetValueType | Partial<KVGetOptions>
): KVGetValueType {
  const string = typeof options === "string";
  const type = string ? options : options?.type ?? "text";
  const cacheTtl = string ? undefined : options?.cacheTtl;
  if (cacheTtl && (isNaN(cacheTtl) || cacheTtl < MIN_CACHE_TTL)) {
    throwKVError(
      "GET",
      400,
      `Invalid cache_ttl of ${cacheTtl}. Cache TTL must be at least ${MIN_CACHE_TTL}.`
    );
  }
  if (!getValueTypes.has(type)) {
    throw new TypeError(
      'Unknown response type. Possible types are "text", "arrayBuffer", "json", and "stream".'
    );
  }
  return type;
}

/** Returns value as an integer or undefined if it isn't one */
function normaliseInt(value: string | number | undefined): number | undefined {
  switch (typeof value) {
    case "string":
      return parseInt(value);
    case "number":
      return Math.round(value);
  }
}

function convertStoredToGetValue(stored: Uint8Array, type: KVGetValueType) {
  switch (type) {
    case "text":
      return decoder.decode(stored);
    case "arrayBuffer":
      return viewToBuffer(stored);
    case "json":
      return JSON.parse(decoder.decode(stored));
    case "stream":
      return new ReadableStream<Uint8Array>({
        type: "bytes" as any,
        // Delay enqueuing chunk until it's actually requested so we can wait
        // for the input gate to open before delivering it
        async pull(controller) {
          await waitForOpenInputGate();
          controller.enqueue(stored);
          controller.close();
          // Not documented in MDN but if there's an ongoing request that's waiting,
          // we need to tell it that there were 0 bytes delivered so that it unblocks
          // and notices the end of stream.
          // @ts-expect-error `byobRequest` has type `undefined` in `@types/node`
          controller.byobRequest?.respond(0);
        },
      });
  }
}

export interface InternalKVNamespaceOptions {
  clock?: Clock;
  blockGlobalAsyncIO?: boolean;
}

export class KVNamespace {
  readonly #storage: Storage;
  readonly #clock: Clock;
  readonly #blockGlobalAsyncIO: boolean;

  constructor(
    storage: Storage,
    {
      clock = defaultClock,
      blockGlobalAsyncIO = false,
    }: InternalKVNamespaceOptions = {}
  ) {
    this.#storage = storage;
    this.#clock = clock;
    this.#blockGlobalAsyncIO = blockGlobalAsyncIO;
  }

  get(
    key: string,
    options?: "text" | Partial<KVGetOptions<"text">>
  ): KVValue<string>;
  get<Value = unknown>(
    key: string,
    options: "json" | KVGetOptions<"json">
  ): KVValue<Value>;
  get(
    key: string,
    options: "arrayBuffer" | KVGetOptions<"arrayBuffer">
  ): KVValue<ArrayBuffer>;
  get(
    key: string,
    options: "stream" | KVGetOptions<"stream">
  ): KVValue<ReadableStream<Uint8Array>>;
  async get<Value = unknown>(
    key: string,
    options?: KVGetValueType | Partial<KVGetOptions>
  ): KVValue<KVPutValueType | Value> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // noinspection SuspiciousTypeOfGuard
    if (typeof key !== "string") {
      throw new TypeError("Failed to execute 'get'" + keyTypeError);
    }

    // Validate key and options
    validateKey("GET", key);
    const type = validateGetOptions(options);

    // Get value without metadata, returning null if not found
    const stored = await this.#storage.get(key, true);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    if (stored === undefined) return null;

    // Return correctly typed value
    return convertStoredToGetValue(stored.value, type);
  }

  getWithMetadata<Metadata = unknown>(
    key: string,
    options?: "text" | Partial<KVGetOptions<"text">>
  ): KVValueMeta<string, Metadata>;
  getWithMetadata<Value = unknown, Metadata = unknown>(
    key: string,
    options: "json" | KVGetOptions<"json">
  ): KVValueMeta<Value, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: "arrayBuffer" | KVGetOptions<"arrayBuffer">
  ): KVValueMeta<ArrayBuffer, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: "stream" | KVGetOptions<"stream">
  ): KVValueMeta<ReadableStream<Uint8Array>, Metadata>;
  async getWithMetadata<Value = unknown, Metadata = unknown>(
    key: string,
    options?: KVGetValueType | Partial<KVGetOptions>
  ): KVValueMeta<KVPutValueType | Value, Metadata> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // noinspection SuspiciousTypeOfGuard
    if (typeof key !== "string") {
      throw new TypeError("Failed to execute 'getWithMetadata'" + keyTypeError);
    }

    // Validate key and options
    validateKey("GET", key);
    const type = validateGetOptions(options);

    // Get value with metadata, returning nulls if not found
    const storedValue = await this.#storage.get<Metadata>(key);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    if (storedValue === undefined) return { value: null, metadata: null };
    const { value, metadata = null } = storedValue;

    // Return correctly typed value with metadata
    return { value: convertStoredToGetValue(value, type), metadata };
  }

  async put<Meta = unknown>(
    key: string,
    value: KVPutValueType,
    options: KVPutOptions<Meta> = {}
  ): Promise<void> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // noinspection SuspiciousTypeOfGuard
    if (typeof key !== "string") {
      throw new TypeError("Failed to execute 'put'" + keyTypeError);
    }

    validateKey("PUT", key);

    // Convert value to Uint8Array
    let stored: Uint8Array;
    if (typeof value === "string") {
      stored = encoder.encode(value);
    } else if (value instanceof ReadableStream) {
      // @ts-expect-error @types/node stream/consumers doesn't accept ReadableStream
      stored = new Uint8Array(await arrayBuffer(value));
    } else if (value instanceof ArrayBuffer) {
      stored = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      stored = viewToArray(value);
    } else {
      throw new TypeError(
        "KV put() accepts only strings, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values."
      );
    }

    // Normalise and validate expiration
    const now = millisToSeconds(this.#clock());
    let expiration = normaliseInt(options.expiration);
    const expirationTtl = normaliseInt(options.expirationTtl);
    if (expirationTtl !== undefined) {
      if (expirationTtl < MIN_EXPIRATION || expirationTtl > MAX_EXPIRATION) {
        // Workers throws like this without the extra sugar when the value is out of bounds, and throws before checking the value itself.
        throw new TypeError(
          `Value out of range. Must be between ${MIN_EXPIRATION} and ${MAX_EXPIRATION} (inclusive).`
        );
      }
      if (isNaN(expirationTtl) || expirationTtl <= 0) {
        throwKVError(
          "PUT",
          400,
          `Invalid expiration_ttl of ${options.expirationTtl}. Please specify integer greater than 0.`
        );
      }
      if (expirationTtl < MIN_CACHE_TTL) {
        throwKVError(
          "PUT",
          400,
          `Invalid expiration_ttl of ${options.expirationTtl}. Expiration TTL must be at least ${MIN_CACHE_TTL}.`
        );
      }
      expiration = now + expirationTtl;
    } else if (expiration !== undefined) {
      if (expiration < MIN_EXPIRATION || expiration > MAX_EXPIRATION) {
        // Workers throws like this without the extra sugar when the value is out of bounds, and throws before checking the value itself.
        throw new TypeError(
          `Value out of range. Must be between ${MIN_EXPIRATION} and ${MAX_EXPIRATION} (inclusive).`
        );
      }
      if (isNaN(expiration) || expiration <= now) {
        throwKVError(
          "PUT",
          400,
          `Invalid expiration of ${options.expiration}. Please specify integer greater than the current number of seconds since the UNIX epoch.`
        );
      }
      if (expiration < now + MIN_CACHE_TTL) {
        throwKVError(
          "PUT",
          400,
          `Invalid expiration of ${options.expiration}. Expiration times must be at least ${MIN_CACHE_TTL} seconds in the future.`
        );
      }
    }

    // Validate value and metadata size
    if (stored.byteLength > MAX_VALUE_SIZE) {
      throwKVError(
        "PUT",
        413,
        `Value length of ${stored.byteLength} exceeds limit of ${MAX_VALUE_SIZE}.`
      );
    }
    const metadataLength =
      options.metadata &&
      encoder.encode(JSON.stringify(options.metadata)).byteLength;
    if (metadataLength && metadataLength > MAX_METADATA_SIZE) {
      throwKVError(
        "PUT",
        413,
        `Metadata length of ${metadataLength} exceeds limit of ${MAX_METADATA_SIZE}.`
      );
    }

    // Store value with expiration and metadata
    await waitForOpenOutputGate();
    await this.#storage.put(key, {
      value: stored,
      expiration,
      metadata: options.metadata,
    });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
  }

  async delete(key: string): Promise<void> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // noinspection SuspiciousTypeOfGuard
    if (typeof key !== "string") {
      throw new TypeError("Failed to execute 'delete'" + keyTypeError);
    }

    validateKey("DELETE", key);
    await waitForOpenOutputGate();
    await this.#storage.delete(key);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
  }

  async list<Meta = unknown>({
    prefix = "",
    limit = MAX_LIST_KEYS,
    cursor,
  }: KVListOptions = {}): Promise<KVListResult<Meta>> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // Validate options
    if (isNaN(limit) || limit < 1) {
      throwKVError(
        "GET",
        400,
        `Invalid key_count_limit of ${limit}. Please specify an integer greater than 0.`
      );
    }
    if (limit > MAX_LIST_KEYS) {
      throwKVError(
        "GET",
        400,
        `Invalid key_count_limit of ${limit}. Please specify an integer less than ${MAX_LIST_KEYS}.`
      );
    }
    const res = await this.#storage.list<Meta>({ prefix, limit, cursor });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    return {
      keys: res.keys,
      cursor: res.cursor,
      list_complete: res.cursor === "",
    };
  }
}
