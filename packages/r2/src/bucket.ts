import { Blob } from "buffer";
import { arrayBuffer } from "stream/consumers";
import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import {
  RangeStoredValueMeta,
  RequestContext,
  Storage,
  assertInRequest,
  getRequestContext,
  viewToArray,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import { Headers } from "undici";
import {
  R2Object,
  R2ObjectBody,
  createHash,
  createVersion,
  parseHttpMetadata,
  parseOnlyIf,
  parseR2ObjectMetadata,
  testR2Conditional,
} from "./r2Object";
import { R2HTTPMetadata, R2ObjectMetadata } from "./r2Object";

// For more information, refer to https://datatracker.ietf.org/doc/html/rfc7232
export interface R2Conditional {
  // Performs the operation if the object’s etag matches the given string.
  etagMatches?: string | string[];
  // Performs the operation if the object’s etag does not match the given string.
  etagDoesNotMatch?: string | string[];
  // Performs the operation if the object was uploaded before the given date.
  uploadedBefore?: Date;
  // Performs the operation if the object was uploaded after the given date.
  uploadedAfter?: Date;
}

export interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

export interface R2GetOptions {
  // Specifies that the object should only be returned given satisfaction of
  // certain conditions in the R2Conditional. Refer to R2Conditional above.
  onlyIf?: R2Conditional | Headers;
  // Specifies that only a specific length (from an optional offset) or suffix
  // of bytes from the object should be returned. Refer to
  // https://developers.cloudflare.com/r2/runtime-apis/#ranged-reads.
  range?: R2Range;
}

export type R2PutValueType =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob;
export interface R2PutOptions {
  // Specifies that the object should only be stored given satisfaction of
  // certain conditions in the R2Conditional. Refer to R2Conditional above.
  onlyIf?: R2Conditional | Headers;
  // Various HTTP headers associated with the object. Refer to
  // https://developers.cloudflare.com/r2/runtime-apis/#http-metadata.
  httpMetadata?: R2HTTPMetadata | Headers;
  // A map of custom, user-defined metadata that will be stored with the object.
  customMetadata?: Record<string, string>;
  // A md5 hash to use to check the recieved object’s integrity.
  md5?: ArrayBuffer | string;
}

export type R2ListOptionsInclude = ("httpMetadata" | "customMetadata")[];

export interface R2ListOptions {
  // The number of results to return. Defaults to 1000, with a maximum of 1000.
  limit?: number;
  // The prefix to match keys against. Keys will only be returned if they start with given prefix.
  prefix?: string;
  // An opaque token that indicates where to continue listing objects from.
  // A cursor can be retrieved from a previous list operation.
  cursor?: string;
  // Key after which the list results should start, exclusive.
  startAfter?: string;
  // The character to use when grouping keys.
  delimiter?: string;
  // Can include httpMetadata and/or customMetadata. If included, items returned by
  // the list will include the specified metadata. Note that there is a limit on the
  // total amount of data that a single list operation can return.
  // If you request data, you may recieve fewer than limit results in your response
  // to accomodate metadata.
  // Use the truncated property to determine if the list request has more data to be returned.
  include?: R2ListOptionsInclude;
}

interface R2PartialListOptions {
  prefix: string;
  limit: number;
  include: R2ListOptionsInclude;
  delimitedPrefixes: Set<string>;
  delimiter?: string;
  startAfter?: string;
  cursor?: string;
}

export interface R2Objects {
  // An array of objects matching the list request.
  objects: R2Object[];
  // If true, indicates there are more results to be retrieved for the current list request.
  truncated: boolean;
  // A token that can be passed to future list calls to resume listing from that point.
  // Only present if truncated is true.
  cursor?: string;
  // If a delimiter has been specified, contains all prefixes between the specified
  // prefix and the next occurence of the delimiter.
  // For example, if no prefix is provided and the delimiter is ‘/’, foo/bar/baz
  // would return foo as a delimited prefix. If foo/ was passed as a prefix
  // with the same structure and delimiter, foo/bar would be returned as a delimited prefix.
  delimitedPrefixes: string[];
}

interface PartialListResponse {
  objects: R2Object[];
  cursor: string;
}

const MAX_LIST_KEYS = 1_000;
const MAX_KEY_SIZE = 1024;
// https://developers.cloudflare.com/r2/platform/limits/ (5GB - 5MB)
const MAX_VALUE_SIZE = 5 * 1_000 * 1_000 * 1_000 - 5 * 1_000 * 1_000;
const UNPAIRED_SURROGATE_PAIR_REGEX =
  /^(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])$/;

const encoder = new TextEncoder();

type Method = "HEAD" | "GET" | "PUT" | "LIST" | "DELETE";

function throwR2Error(method: Method, status: number, message: string): void {
  throw new Error(`R2 ${method} failed: (${status}) ${message}`);
}

function validateKey(method: Method, key: string): void {
  // Check key isn't too long and exists outside regex
  const keyLength = encoder.encode(key).byteLength;
  if (UNPAIRED_SURROGATE_PAIR_REGEX.test(key)) {
    throwR2Error(method, 400, "Key contains an illegal unicode value(s).");
  }
  if (keyLength >= MAX_KEY_SIZE) {
    throwR2Error(
      method,
      414,
      `UTF-8 encoded length of ${keyLength} exceeds key length limit of ${MAX_KEY_SIZE}.`
    );
  }
}

function validateOnlyIf(
  onlyIf: R2Conditional | Headers,
  method: "GET" | "PUT"
): void {
  if (onlyIf instanceof Headers) return;
  if (typeof onlyIf !== "object") {
    throwR2Error(
      method,
      400,
      "onlyIf must be an object, a Headers instance, or undefined."
    );
  }

  // Check onlyIf variables
  const { etagMatches, etagDoesNotMatch, uploadedBefore, uploadedAfter } =
    onlyIf;
  if (
    etagMatches !== undefined &&
    !(typeof etagMatches === "string" || Array.isArray(etagMatches))
  ) {
    throwR2Error(method, 400, "etagMatches must be a string.");
  }
  if (
    etagDoesNotMatch !== undefined &&
    !(typeof etagDoesNotMatch === "string" || Array.isArray(etagDoesNotMatch))
  ) {
    throwR2Error(method, 400, "etagDoesNotMatch must be a string.");
  }
  if (uploadedBefore !== undefined && !(uploadedBefore instanceof Date)) {
    throwR2Error(method, 400, "uploadedBefore must be a Date.");
  }
  if (uploadedAfter !== undefined && !(uploadedAfter instanceof Date)) {
    throwR2Error(method, 400, "uploadedAfter must be a Date.");
  }
}

function validateGetOptions(options: R2GetOptions): void {
  const { onlyIf = {}, range = {} } = options;

  validateOnlyIf(onlyIf, "GET");

  if (typeof range !== "object") {
    throwR2Error("GET", 400, "range must either be an object or undefined.");
  }
  const { offset, length, suffix } = range;

  if (offset !== undefined) {
    if (typeof offset !== "number") {
      throwR2Error("GET", 400, "offset must either be a number or undefined.");
    }
    if (offset < 0) {
      throwR2Error(
        "GET",
        400,
        "Invalid range. Starting offset must be greater than or equal to 0."
      );
    }
  }
  if (length !== undefined && typeof length !== "number") {
    throwR2Error("GET", 400, "length must either be a number or undefined.");
  }
  if (suffix !== undefined && typeof suffix !== "number") {
    throwR2Error("GET", 400, "suffix must either be a number or undefined.");
  }
}

function validateHttpMetadata(httpMetadata?: R2HTTPMetadata | Headers): void {
  if (httpMetadata === undefined || httpMetadata instanceof Headers) return;
  if (typeof httpMetadata !== "object") {
    throwR2Error("PUT", 400, "httpMetadata must be an object or undefined.");
  }
  for (const [key, value] of Object.entries(httpMetadata)) {
    if (key === "cacheExpiry") {
      if (!(value instanceof Date) && value !== undefined) {
        throwR2Error(
          "PUT",
          400,
          "cacheExpiry's value must be a Date or undefined."
        );
      }
    } else {
      if (typeof value !== "string" && value !== undefined) {
        throwR2Error(
          "PUT",
          400,
          `${key}'s value must be a string or undefined.`
        );
      }
    }
  }
}

function validatePutOptions(options: R2PutOptions): void {
  const { onlyIf = {}, httpMetadata, customMetadata, md5 } = options;

  validateOnlyIf(onlyIf, "PUT");
  validateHttpMetadata(httpMetadata);

  if (customMetadata !== undefined) {
    if (typeof customMetadata !== "object") {
      throwR2Error(
        "PUT",
        400,
        "customMetadata must be an object or undefined."
      );
    }
    for (const value of Object.values(customMetadata)) {
      if (typeof value !== "string") {
        throwR2Error("PUT", 400, "customMetadata values must be strings.");
      }
    }
  }

  if (
    md5 !== undefined &&
    !(md5 instanceof ArrayBuffer) &&
    typeof md5 !== "string"
  ) {
    throwR2Error(
      "PUT",
      400,
      "md5 must be a string, ArrayBuffer, or undefined."
    );
  }
}

function validateListOptions(options: R2ListOptions): void {
  const { limit, prefix, cursor, delimiter, startAfter, include } = options;

  if (limit !== undefined) {
    if (typeof limit !== "number") {
      throwR2Error("LIST", 400, "limit must be a number or undefined.");
    }
    if (limit < 1 || limit > MAX_LIST_KEYS) {
      throwR2Error(
        "LIST",
        400,
        `MaxKeys params must be positive integer <= 1000.`
      );
    }
  }
  if (prefix !== undefined && typeof prefix !== "string") {
    throwR2Error("LIST", 400, "prefix must be a string or undefined.");
  }
  if (cursor !== undefined && typeof cursor !== "string") {
    throwR2Error("LIST", 400, "cursor must be a string or undefined.");
  }
  if (delimiter !== undefined && typeof delimiter !== "string") {
    throwR2Error("LIST", 400, "delimiter must be a string or undefined.");
  }
  if (startAfter !== undefined && typeof startAfter !== "string") {
    throwR2Error("LIST", 400, "startAfter must be a string or undefined.");
  }
  if (include !== undefined) {
    if (!Array.isArray(include)) {
      throwR2Error("LIST", 400, "include must be an array or undefined.");
    }
    for (const value of include) {
      if (value !== "httpMetadata" && value !== "customMetadata") {
        throwR2Error(
          "LIST",
          400,
          "include values must be httpMetadata and/or customMetadata strings."
        );
      }
    }
  }
}

/** @internal */
export async function _valueToArray(
  value: R2PutValueType
): Promise<Uint8Array> {
  if (typeof value === "string") {
    return encoder.encode(value);
  } else if (value instanceof ReadableStream) {
    // @ts-expect-error @types/node stream/consumers doesn't accept ReadableStream
    return new Uint8Array(await arrayBuffer(value));
  } else if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    return viewToArray(value);
  } else if (value === null) {
    return new Uint8Array();
  } else if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  } else {
    throw new TypeError(
      "R2 put() accepts only nulls, strings, Blobs, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values."
    );
  }
}

export interface InternalR2BucketOptions {
  blockGlobalAsyncIO?: boolean;
}

export class R2Bucket {
  readonly #storage: Storage;
  readonly #blockGlobalAsyncIO: boolean;

  constructor(
    storage: Storage,
    { blockGlobalAsyncIO = false }: InternalR2BucketOptions = {}
  ) {
    this.#storage = storage;
    this.#blockGlobalAsyncIO = blockGlobalAsyncIO;
  }

  #prepareCtx(method: Method, key?: string): RequestContext | undefined {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    // noinspection SuspiciousTypeOfGuard
    if (method !== "LIST" && typeof key !== "string") {
      throw new TypeError(
        `Failed to execute '${method.toLowerCase()}'` +
          " on 'R2Bucket': parameter 1 is not of type 'string'."
      );
    }

    return ctx;
  }

  async #head(key: string, ctx?: RequestContext): Promise<R2Object | null> {
    if (ctx === undefined) ctx = this.#prepareCtx("HEAD", key);

    // Validate key
    validateKey("HEAD", key);

    // Get value, returning null if not found
    const stored = await this.#storage.head<R2ObjectMetadata>(key);
    // fix dates
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    if (stored?.metadata === undefined) return null;
    const { metadata } = stored;
    parseR2ObjectMetadata(metadata);

    return new R2Object(metadata);
  }

  async head(key: string): Promise<R2Object | null> {
    return this.#head(key);
  }

  /**
   * Returns R2Object on a failure of the conditional specified in onlyIf.
   */
  async get(key: string): Promise<R2ObjectBody | null>;
  async get(
    key: string,
    options: R2GetOptions
  ): Promise<R2ObjectBody | R2Object | null>;
  async get(
    key: string,
    options?: R2GetOptions
  ): Promise<R2ObjectBody | R2Object | null> {
    const ctx = this.#prepareCtx("GET", key);
    options = options ?? {};
    const { range = {} } = options;

    // Validate key
    validateKey("GET", key);
    // Validate options
    validateGetOptions(options);

    // In the event that an onlyIf precondition fails, we return
    // the R2Object without the body. Otherwise return with body.
    const onlyIf = parseOnlyIf(options.onlyIf);
    const meta = await this.#head(key, ctx);
    // if bad metadata, return null
    if (meta === null) return null;
    // test conditional should it exist
    if (!testR2Conditional(onlyIf, meta) || meta?.size === 0) {
      return new R2Object(meta);
    }

    let stored: RangeStoredValueMeta<R2ObjectMetadata> | undefined;

    // get data dependent upon whether suffix or range exists
    try {
      stored = await this.#storage.getRange<R2ObjectMetadata>(
        key,
        range.offset,
        range.length,
        range.suffix
      );
    } catch {
      throwR2Error("GET", 400, "The requested range is not satisfiable.");
    }

    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    // if bad metadata, return null
    if (stored?.metadata === undefined) return null;
    const { value, metadata } = stored;
    // fix dates
    parseR2ObjectMetadata(metadata);
    // add range should it exist
    if ("range" in stored && stored.range !== undefined) {
      metadata.range = stored.range;
    }

    return new R2ObjectBody(metadata, value);
  }

  async put(
    key: string,
    value: R2PutValueType,
    options: R2PutOptions = {}
  ): Promise<R2Object | null> {
    const ctx = this.#prepareCtx("PUT", key);
    // Validate key
    validateKey("PUT", key);
    // Validate options
    validatePutOptions(options);

    const { customMetadata = {} } = options;
    let { md5, onlyIf, httpMetadata } = options;
    onlyIf = parseOnlyIf(onlyIf);
    httpMetadata = parseHttpMetadata(httpMetadata);

    // Get meta, and if exists, run onlyIf condtional test
    const meta = (await this.#head(key, ctx)) ?? undefined;
    if (!testR2Conditional(onlyIf, meta)) return null;

    // Convert value to Uint8Array
    const toStore = await _valueToArray(value);

    // Validate value and metadata size
    if (toStore.byteLength > MAX_VALUE_SIZE) {
      throwR2Error(
        "PUT",
        400,
        `Value length of ${toStore.byteLength} exceeds limit of ${MAX_VALUE_SIZE}.`
      );
    }

    // if md5 is provided, check objects integrity
    const md5Hash = createHash(toStore);
    if (md5 !== undefined) {
      // convert to string
      if (md5 instanceof ArrayBuffer) {
        md5 = Buffer.from(new Uint8Array(md5)).toString("hex");
      }
      if (md5 !== md5Hash) {
        throwR2Error(
          "PUT",
          400,
          "The Content-MD5 you specified did not match what we received."
        );
      }
    }

    // build metadata
    const metadata: R2ObjectMetadata = {
      key,
      size: toStore.byteLength,
      etag: md5Hash,
      version: createVersion(),
      httpEtag: `"${md5Hash}"`,
      uploaded: new Date(),
      httpMetadata,
      customMetadata,
    };

    // Store value with expiration and metadata
    await waitForOpenOutputGate();
    await this.#storage.put<R2ObjectMetadata>(key, {
      value: toStore,
      metadata,
    });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return new R2Object(metadata);
  }

  async delete(key: string): Promise<void> {
    const ctx = this.#prepareCtx("DELETE", key);

    validateKey("DELETE", key);
    await waitForOpenOutputGate();
    await this.#storage.delete(key);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
  }

  // due to the delimiter, we may need to run multiple queries
  // the goal is to keep returning results until either we have no more
  // or objects + delmitedPrefixes are equal to maxResults
  async #list({
    prefix,
    limit,
    include,
    delimitedPrefixes,
    delimiter,
    startAfter,
    cursor,
  }: R2PartialListOptions): Promise<PartialListResponse> {
    // the storage list implementation is *inclusive* of start
    // r2 implementation is *exclusive*
    // to avoid issues with limit count being wrong, we need to add 1
    if (startAfter !== undefined) limit++;

    const res = await this.#storage.list<R2ObjectMetadata>({
      prefix,
      limit,
      cursor,
      start: startAfter,
    });

    const objects = res.keys
      // grab metadata
      .map((k) => k.metadata)
      // filter out objects that exist within the delimiter
      .filter((metadata): metadata is R2ObjectMetadata => {
        if (metadata === undefined) return false;
        const objectKey = metadata.key.slice(prefix.length);
        if (delimiter !== undefined && objectKey.includes(delimiter)) {
          const delimitedPrefix =
            prefix + objectKey.split(delimiter)[0] + delimiter;
          delimitedPrefixes.add(delimitedPrefix);
          return false;
        }
        // otherwise, return true
        return true;
      })
      // filter "httpMetadata" and/or "customMetadata" if found in "include"
      .map((metadata) => {
        if (!include.includes("httpMetadata")) metadata.httpMetadata = {};
        if (!include.includes("customMetadata")) metadata.customMetadata = {};
        // fix dates
        parseR2ObjectMetadata(metadata);

        return new R2Object(metadata);
      });

    // if startAfter is provided, ensure the first object is the one after startAfter
    // if for some reason the first object is not startAfter itself, reduce size by 1
    if (startAfter !== undefined) {
      if (objects[0].key === startAfter) {
        objects.splice(0, 1);
      } else if (objects.length > limit - 1) {
        objects.splice(0, limit - 1);
      }
    }

    return { objects, cursor: res.cursor };
  }

  async list(listOptions: R2ListOptions = {}): Promise<R2Objects> {
    const ctx = this.#prepareCtx("LIST");
    let truncated = false;
    const objects: R2Object[] = [];
    const delimitedPrefixes = new Set<string>();

    validateListOptions(listOptions);
    const { prefix = "", include = [] } = listOptions;
    let {
      delimiter,
      startAfter,
      limit = MAX_LIST_KEYS,
      cursor = "",
    } = listOptions;
    if (delimiter === "") delimiter = undefined;

    // if include contains inputs, we reduce the limit to max 100
    if (include.length > 0) limit = Math.min(limit, 100);

    // iterate until we find no more objects or we have reached the limit
    do {
      const { objects: _objects, cursor: _cursor } = await this.#list({
        prefix,
        limit: limit - objects.length, // adjust limit to have the correct cursor returned
        include,
        delimitedPrefixes,
        delimiter,
        startAfter,
        cursor,
      });
      // kill startAfter after the first iteration
      startAfter = undefined;
      // update cursor
      cursor = _cursor;
      // if no objects found, we are done
      if (_objects.length === 0) break;
      // add objects to list
      objects.push(..._objects);
    } while (
      cursor.length > 0 &&
      objects.length + delimitedPrefixes.size < limit
    );

    if (cursor.length > 0) truncated = true;
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return {
      objects,
      truncated,
      cursor: cursor.length > 0 ? cursor : undefined,
      delimitedPrefixes: [...delimitedPrefixes],
    };
  }
}
