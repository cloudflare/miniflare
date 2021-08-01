import { ReadableStream } from "stream/web";
import { KVClock, defaultClock, millisToSeconds } from "./helpers";
import { KVStorage } from "./storage";

const collator = new Intl.Collator();

// Returns value as an integer or undefined if it isn't one
function normaliseInt(value: string | number | undefined) {
  switch (typeof value) {
    case "string":
      const parsed = parseInt(value);
      return isNaN(parsed) ? undefined : parsed;
    case "number":
      return Math.round(value);
    default:
      return undefined;
  }
}

// Returns a buffer containing a concatenation of all chunks written to a stream
function consumeReadableStream(stream: ReadableStream) {
  return new Promise<Buffer>((resolve, reject) => {
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let totalLength = 0;

    // Keep pushing until we're done reading the stream
    function push() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            resolve(Buffer.concat(chunks, totalLength));
          } else {
            const chunk = Buffer.from(value);
            totalLength += chunk.length;
            chunks.push(chunk);
            push();
          }
        })
        .catch(reject);
    }
    push();
  });
}

export type KVValue<Value> = Promise<Value | null>;
export type KVValueWithMetadata<Value, Metadata> = Promise<{
  value: Value | null;
  metadata: Metadata | null;
}>;

export type KVGetValueType = "text" | "json" | "arrayBuffer" | "stream";
export type KVGetOptions =
  | KVGetValueType
  | { type?: KVGetValueType; cacheTtl?: number };

// Normalises type, ignoring cacheTtl as there is only one "edge location":
// the user's computer
function validateGetType(options: KVGetOptions): KVGetValueType {
  const type = typeof options === "string" ? options : options.type ?? "text";

  // Validate type
  if (!["text", "json", "arrayBuffer", "stream"].includes(type)) {
    throw new TypeError(
      `Invalid type: expected "text" | "json" | "arrayBuffer" | "stream", got "${type}"`
    );
  }

  return type;
}

function convertToGetType(value: Buffer, type: KVGetValueType) {
  switch (type) {
    case "text":
      return value.toString("utf8");
    case "arrayBuffer":
      return Uint8Array.from(value).buffer;
    case "json":
      return JSON.parse(value.toString("utf8"));
    case "stream":
      return new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from(value));
          controller.close();
        },
      });
  }
}

export type KVPutValueType = string | ReadableStream | ArrayBuffer;
export interface KVPutOptions {
  expiration?: string | number;
  expirationTtl?: string | number;
  metadata?: any;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface KVListResult {
  keys: { name: string; expiration?: number; metadata?: unknown }[];
  list_complete: boolean;
  cursor: string;
}

export class KVStorageNamespace {
  readonly #storage: KVStorage;
  readonly #clock: KVClock;

  constructor(storage: KVStorage, clock: KVClock = defaultClock) {
    this.#storage = storage;
    this.#clock = clock;
  }

  get(key: string, options?: { cacheTtl?: number }): KVValue<string>;
  get(key: string, type: "text"): KVValue<string>;
  get(
    key: string,
    options: { type: "text"; cacheTtl?: number }
  ): KVValue<string>;
  get<Value = unknown>(key: string, type: "json"): KVValue<Value>;
  get<Value = unknown>(
    key: string,
    options: { type: "json"; cacheTtl?: number }
  ): KVValue<Value>;
  get(key: string, type: "arrayBuffer"): KVValue<ArrayBuffer>;
  get(
    key: string,
    options: { type: "arrayBuffer"; cacheTtl?: number }
  ): KVValue<ArrayBuffer>;
  get(key: string, type: "stream"): KVValue<ReadableStream>;
  get(
    key: string,
    options: { type: "stream"; cacheTtl?: number }
  ): KVValue<ReadableStream>;
  async get(key: string, options: KVGetOptions = {}): KVValue<any> {
    const type = validateGetType(options);

    // Get value without metadata, returning null if not found
    const storedValue = await this.#storage.get(key, true);
    if (storedValue === undefined) return null;

    // Return correctly typed value
    return convertToGetType(storedValue.value, type);
  }

  getWithMetadata<Metadata = unknown>(
    key: string,
    options?: { cacheTtl?: number }
  ): KVValueWithMetadata<string, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "text"
  ): KVValueWithMetadata<string, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: { type: "text"; cacheTtl?: number }
  ): KVValueWithMetadata<string, Metadata>;
  getWithMetadata<Value = unknown, Metadata = unknown>(
    key: string,
    type: "json"
  ): KVValueWithMetadata<Value, Metadata>;
  getWithMetadata<Value = unknown, Metadata = unknown>(
    key: string,
    options: { type: "json"; cacheTtl?: number }
  ): KVValueWithMetadata<Value, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "arrayBuffer"
  ): KVValueWithMetadata<ArrayBuffer, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: { type: "arrayBuffer"; cacheTtl?: number }
  ): KVValueWithMetadata<ArrayBuffer, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "stream"
  ): KVValueWithMetadata<ReadableStream, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    options: { type: "stream"; cacheTtl?: number }
  ): KVValueWithMetadata<ReadableStream, Metadata>;
  async getWithMetadata<Metadata = unknown>(
    key: string,
    options: KVGetOptions = {}
  ): KVValueWithMetadata<any, Metadata> {
    const type = validateGetType(options);

    // Get value with metadata, returning nulls if not found
    const storedValue = await this.#storage.get(key);
    if (storedValue === undefined) return { value: null, metadata: null };
    const { value, metadata = null } = storedValue;

    // Return correctly typed value with metadata
    return { value: convertToGetType(value, type), metadata };
  }

  async put(
    key: string,
    value: KVPutValueType,
    { expiration, expirationTtl, metadata }: KVPutOptions = {}
  ): Promise<void> {
    // Convert value to a buffer
    let buffer: Buffer;
    if (value instanceof ReadableStream) {
      buffer = await consumeReadableStream(value);
    } else if (value instanceof ArrayBuffer) {
      buffer = Buffer.from(value);
    } else {
      buffer = Buffer.from(value, "utf8");
    }

    // Normalise expiration
    expiration = normaliseInt(expiration);
    expirationTtl = normaliseInt(expirationTtl);
    if (expirationTtl !== undefined) {
      expiration = millisToSeconds(this.#clock()) + expirationTtl;
    }

    // Store value with expiration and metadata
    await this.#storage.put(key, {
      value: buffer,
      expiration,
      metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.#storage.delete(key);
  }

  async list({
    prefix = "",
    limit = 1000,
    cursor,
  }: KVListOptions = {}): Promise<KVListResult> {
    // Validate options
    if (limit <= 0) {
      throw new TypeError(`Invalid limit: expected number > 0, got ${limit}`);
    }
    // We store the the cursor as the key to start AFTER so keys inserted whilst
    // paginating are returned
    const startAfter =
      cursor === undefined
        ? ""
        : Buffer.from(cursor, "base64").toString("utf8");

    // Get all keys matching the prefix, cursor and limit
    let nextName = "";
    const slicedKeys = await this.#storage.list({
      prefix,
      keysFilter(keys) {
        // Sort the keys (in-place), so the cursor works correctly
        keys.sort((a, b) => collator.compare(a.name, b.name));

        // Find the correct part of the sorted array to return
        let startIndex = 0;
        if (startAfter !== "") {
          startIndex = keys.findIndex(({ name }) => name === startAfter);
          // If we couldn't find where to start, return nothing
          if (startIndex === -1) {
            startIndex = keys.length;
          }
          // Since we want to start AFTER this index, add 1 to it
          startIndex++;
        }
        const endIndex = startIndex + limit;
        nextName = endIndex < keys.length ? keys[endIndex - 1].name : "";

        // Get key range to return
        return keys.slice(startIndex, endIndex);
      },
    });

    // Build next cursor and return keys
    const nextCursor =
      nextName === "" ? "" : Buffer.from(nextName, "utf8").toString("base64");
    return {
      keys: slicedKeys,
      list_complete: nextName === "",
      cursor: nextCursor,
    };
  }
}
