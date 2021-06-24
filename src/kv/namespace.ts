import { ReadableStream } from "web-streams-polyfill/ponyfill/es6";
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

export type KVClock = () => number;
const defaultClock: KVClock = () => Math.floor(Date.now() / 1000);

export type KVValue<Value> = Promise<Value | null>;
export type KVValueWithMetadata<Value, Metadata> = Promise<{
  value: Value | null;
  metadata: Metadata | null;
}>;

export type KVGetValueType = "text" | "json" | "arrayBuffer" | "stream";

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
  constructor(
    private storage: KVStorage,
    private clock: KVClock = defaultClock
  ) {}

  get(key: string): KVValue<string>;
  get(key: string, type: "text"): KVValue<string>;
  get<Value = unknown>(key: string, type: "json"): KVValue<Value>;
  get(key: string, type: "arrayBuffer"): KVValue<ArrayBuffer>;
  get(key: string, type: "stream"): KVValue<ReadableStream>;
  async get(key: string, type: KVGetValueType = "text"): KVValue<any> {
    return (await this.getWithMetadata(key, type as any)).value;
  }

  getWithMetadata<Metadata = unknown>(
    key: string
  ): KVValueWithMetadata<string, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "text"
  ): KVValueWithMetadata<string, Metadata>;
  getWithMetadata<Value = unknown, Metadata = unknown>(
    key: string,
    type: "json"
  ): KVValueWithMetadata<Value, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "arrayBuffer"
  ): KVValueWithMetadata<ArrayBuffer, Metadata>;
  getWithMetadata<Metadata = unknown>(
    key: string,
    type: "stream"
  ): KVValueWithMetadata<ReadableStream, Metadata>;
  async getWithMetadata<Metadata = unknown>(
    key: string,
    type: KVGetValueType = "text"
  ): KVValueWithMetadata<any, Metadata> {
    // Validate type
    if (!["text", "json", "arrayBuffer", "stream"].includes(type)) {
      throw new TypeError(
        `Invalid type: expected "text" | "json" | "arrayBuffer" | "stream", got "${type}"`
      );
    }

    // Get value with expiration and metadata, if we couldn't find anything,
    // return nulls
    const storedValue = await this.storage.get(key);
    if (storedValue === undefined) {
      return { value: null, metadata: null };
    }
    const { value, expiration, metadata = null } = storedValue;

    // Delete key if expiration defined and expired
    if (expiration !== undefined && expiration <= this.clock()) {
      await this.delete(key);
      return { value: null, metadata: null };
    }

    // Return correctly typed value with metadata
    switch (type) {
      case "text":
        return { value: value.toString("utf8"), metadata };
      case "arrayBuffer":
        return { value: Uint8Array.from(value).buffer, metadata };
      case "json":
        return { value: JSON.parse(value.toString("utf8")), metadata };
      case "stream":
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from(value));
            controller.close();
          },
        });
        return { value: stream, metadata };
    }
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
      expiration = this.clock() + expirationTtl;
    }

    // Store value with expiration and metadata
    await this.storage.put(key, {
      value: buffer,
      expiration,
      metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
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
    const startAfter =
      cursor === undefined
        ? ""
        : Buffer.from(cursor, "base64").toString("utf8");

    // Get all keys matching the prefix, sorted, recording expired keys along
    // the way
    const expiredKeys: string[] = [];
    const time = this.clock();
    const keys = (await this.storage.list())
      .filter(({ name, expiration }) => {
        if (expiration !== undefined && expiration <= time) {
          expiredKeys.push(name);
          return false;
        }
        return name.startsWith(prefix);
      })
      .sort((a, b) => collator.compare(a.name, b.name));

    // Delete expired keys
    for (const expiredKey of expiredKeys) {
      await this.delete(expiredKey);
    }

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
    const slicedKeys = keys.slice(startIndex, endIndex);
    const nextName = endIndex < keys.length ? keys[endIndex - 1].name : "";

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
