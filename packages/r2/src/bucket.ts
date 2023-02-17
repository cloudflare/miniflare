// noinspection SuspiciousTypeOfGuard

import { Blob } from "buffer";
import crypto from "crypto";
import { arrayBuffer } from "stream/consumers";
import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import { parseRanges } from "@miniflare/core";
import {
  RequestContext,
  Storage,
  assertInRequest,
  getRequestContext,
  parseRange,
  viewToArray,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import { Headers } from "undici";
import {
  InternalR2MultipartUploadOptions,
  R2MultipartUpload,
  _INTERNAL_PREFIX,
  createMultipartUpload,
  deleteMultipartParts,
  getMultipartValue,
  validateMultipartKey,
} from "./multipart";
import {
  HEX_REGEXP,
  MAX_KEY_SIZE,
  R2Checksums,
  R2HashAlgorithm,
  R2Object,
  R2ObjectBody,
  R2_HASH_ALGORITHMS,
  createMD5Hash,
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
  range?: R2Range | Headers;
}

export type R2PutValueType =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob;
export interface R2PutOptions extends R2Checksums<ArrayBuffer | string> {
  // Specifies that the object should only be stored given satisfaction of
  // certain conditions in the R2Conditional. Refer to R2Conditional above.
  onlyIf?: R2Conditional | Headers;
  // Various HTTP headers associated with the object. Refer to
  // https://developers.cloudflare.com/r2/runtime-apis/#http-metadata.
  httpMetadata?: R2HTTPMetadata | Headers;
  // A map of custom, user-defined metadata that will be stored with the object.
  customMetadata?: Record<string, string>;
}
export type R2MultipartOptions = Pick<
  R2PutOptions,
  "httpMetadata" | "customMetadata"
>;

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

const MAX_LIST_KEYS = 1_000;
// https://developers.cloudflare.com/r2/platform/limits/ (5GB - 5MB)
const MAX_VALUE_SIZE = 5 * 1_000 * 1_000 * 1_000 - 5 * 1_000 * 1_000;
const UNPAIRED_SURROGATE_PAIR_REGEX =
  /^(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])$/;

const encoder = new TextEncoder();

type Method = "HEAD" | "GET" | "PUT" | "LIST" | "DELETE";

function throwR2Error(method: Method, status: number, message: string): never {
  throw new Error(`R2 ${method} failed: (${status}) ${message}`);
}

function validateKey(method: Method, key: string) {
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
  // Check key doesn't start with internal prefix used for multipart storage
  if (key.startsWith(_INTERNAL_PREFIX)) {
    throwR2Error(method, 400, `Key cannot start with "${_INTERNAL_PREFIX}".`);
  }
  return key;
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

  // Validate range if not `Range` header, that will be validated once we've
  // fetched metadata containing the size
  if (range instanceof Headers) return;
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

interface R2PutOptionHash {
  alg: R2HashAlgorithm;
  hash: Buffer;
}
function validatePutHash(
  options: R2PutOptions,
  alg: R2HashAlgorithm
): R2PutOptionHash | undefined {
  const hash = options[alg.field];
  let buffer: Buffer;
  if (hash === undefined) {
    return;
  } else if (hash instanceof ArrayBuffer) {
    buffer = Buffer.from(hash);
  } else if (ArrayBuffer.isView(hash)) {
    // Note `ArrayBufferView`s are automatically coerced to `ArrayBuffer`'s by
    // the runtime.
    buffer = Buffer.from(viewToArray(hash));
  } else if (typeof hash === "string") {
    const expectedHex = alg.expectedBytes * 2;
    if (hash.length !== expectedHex) {
      throw new TypeError(
        `${alg.name} is ${expectedHex} hex characters, not ${hash.length}`
      );
    }
    if (!HEX_REGEXP.test(hash)) {
      throw new TypeError(`Provided ${alg.name} wasn't a valid hex string`);
    }
    buffer = Buffer.from(hash, "hex");
  } else {
    throw new TypeError(
      `Incorrect type for the '${alg.field}' field on 'PutOptions': the provided value is not of type 'ArrayBuffer or ArrayBufferView or string'.`
    );
  }
  if (buffer.byteLength !== alg.expectedBytes) {
    throw new TypeError(
      `${alg.name} is ${alg.expectedBytes} bytes, not ${buffer.byteLength}`
    );
  }
  return { alg, hash: buffer };
}
function validatePutHashes(options: R2PutOptions): R2PutOptionHash | undefined {
  let hash: R2PutOptionHash | undefined;
  for (const alg of R2_HASH_ALGORITHMS) {
    const validatedHash = validatePutHash(options, alg);
    if (validatedHash !== undefined) {
      if (hash !== undefined) {
        throw new TypeError("You cannot specify multiple hashing algorithms.");
      }
      hash = validatedHash;
    }
  }
  return hash;
}

function validatePutOptions(
  options: R2PutOptions
): R2PutOptionHash | undefined {
  const { onlyIf = {}, httpMetadata, customMetadata } = options;

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

  return validatePutHashes(options);
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

function rangeHeaderToR2Range(headers: Headers, size: number): R2Range {
  const rangeHeader = headers.get("Range");
  if (rangeHeader !== null) {
    const ranges = parseRanges(rangeHeader, size);
    if (ranges?.length === 1) {
      // If the header contained a single range, convert it to an R2Range.
      // Note `start` and `end` are inclusive.
      const [start, end] = ranges[0];
      return { offset: start, length: end - start + 1 };
    }
  }
  // If the header didn't exist, was invalid, or contained multiple ranges,
  // just return the full response
  return {};
}

function buildKeyTypeError(method: keyof R2Bucket): string {
  return `Failed to execute '${method}' on 'R2Bucket': parameter 1 is not of type 'string'.`;
}

export interface InternalR2BucketOptions {
  blockGlobalAsyncIO?: boolean;
  listRespectInclude?: boolean;
  minMultipartUploadSize?: number;
}

export class R2Bucket {
  readonly #storage: Storage;
  readonly #blockGlobalAsyncIO: boolean;
  readonly #listRespectInclude: boolean;
  readonly #multipartOpts: InternalR2MultipartUploadOptions;

  constructor(
    storage: Storage,
    {
      blockGlobalAsyncIO = false,
      listRespectInclude = true,
      minMultipartUploadSize,
    }: InternalR2BucketOptions = {}
  ) {
    this.#storage = storage;
    this.#blockGlobalAsyncIO = blockGlobalAsyncIO;
    this.#listRespectInclude = listRespectInclude;
    this.#multipartOpts = {
      storage,
      blockGlobalAsyncIO,
      minMultipartUploadSize,
    };
  }

  #prepareCtx(): RequestContext | undefined {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    return ctx;
  }

  async #head(key: string): Promise<R2ObjectMetadata | null> {
    // Get value, returning null if not found
    const stored = await this.#storage.head<R2ObjectMetadata>(key);
    // fix dates
    if (stored?.metadata === undefined) return null;
    const { metadata } = stored;
    parseR2ObjectMetadata(metadata);

    return metadata;
  }

  async head(key: string): Promise<R2Object | null> {
    const ctx = this.#prepareCtx();

    // The Workers runtime will coerce the key parameter to a string
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("head"));
    }
    key = String(key);
    // Validate key
    validateKey("HEAD", key);

    const meta = await this.#head(key);
    await waitForOpenInputGate();

    ctx?.advanceCurrentTime();
    return meta === null ? null : new R2Object(meta);
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
    const ctx = this.#prepareCtx();
    options = options ?? {};
    let { range = {} } = options;

    // The Workers runtime will coerce the key parameter to a string
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("get"));
    }
    key = String(key);
    // Validate key
    validateKey("GET", key);
    // Validate options
    validateGetOptions(options);

    // In the event that an onlyIf precondition fails, we return
    // the R2Object without the body. Otherwise return with body.
    const onlyIf = parseOnlyIf(options.onlyIf);
    const meta = await this.#head(key);
    // if bad metadata, return null
    if (meta === null) {
      await waitForOpenInputGate();
      ctx?.advanceCurrentTime();
      return null;
    }
    // test conditional should it exist
    if (!testR2Conditional(onlyIf, meta)) {
      await waitForOpenInputGate();
      ctx?.advanceCurrentTime();
      return new R2Object(meta);
    }

    // Convert `Range` header to R2Range if specified
    if (range instanceof Headers) {
      range = rangeHeaderToR2Range(range, meta.size);
    }

    let value: Uint8Array | ReadableStream<Uint8Array>;
    try {
      if (meta.size === 0) {
        value = new Uint8Array();
      } else if (meta.multipart !== undefined) {
        const parsedRange = parseRange(range, meta.size);
        value = getMultipartValue(
          this.#storage,
          key,
          meta.multipart,
          parsedRange
        );
        meta.range = parsedRange;
      } else {
        const stored = await this.#storage.getRange<R2ObjectMetadata>(
          key,
          range
        );
        if (stored === undefined) return null;
        value = stored.value;
        // Add range should it exist
        if ("range" in stored && stored.range !== undefined) {
          meta.range = stored.range;
        }
      }
    } catch {
      throwR2Error("GET", 400, "The requested range is not satisfiable.");
    }

    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return new R2ObjectBody(meta, value);
  }

  async put(
    key: string,
    value: R2PutValueType,
    options: R2PutOptions = {}
  ): Promise<R2Object | null> {
    const ctx = this.#prepareCtx();

    // The Workers runtime will coerce the key parameter to a string
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("put"));
    }
    key = String(key);
    // Validate key
    validateKey("PUT", key);
    // Validate options
    const specifiedHash = validatePutOptions(options);

    const { customMetadata = {} } = options;
    let { onlyIf, httpMetadata } = options;
    onlyIf = parseOnlyIf(onlyIf);
    httpMetadata = parseHttpMetadata(httpMetadata);

    // Get meta, and if exists, run onlyIf condtional test
    const meta = (await this.#head(key)) ?? undefined;
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

    // If hash is provided, check objects integrity
    const checksums: R2Checksums<string> = {};
    if (specifiedHash !== undefined) {
      const computedHash = crypto
        .createHash(specifiedHash.alg.field)
        .update(toStore)
        .digest();
      if (!specifiedHash.hash.equals(computedHash)) {
        throw new Error(
          `put: The ${specifiedHash.alg.name} checksum you specified did not match what we received.`
        );
      }
      // Store computed hash to ensure consistent casing in returned checksums
      // from `R2Object`
      checksums[specifiedHash.alg.field] = computedHash.toString("hex");
    }

    // Build metadata
    const md5Hash = createMD5Hash(toStore);
    const metadata: R2ObjectMetadata = {
      key,
      size: toStore.byteLength,
      etag: md5Hash,
      version: createVersion(),
      httpEtag: `"${md5Hash}"`,
      uploaded: new Date(),
      httpMetadata,
      customMetadata,
      checksums,
    };

    // Store value with expiration and metadata
    await waitForOpenOutputGate();
    await this.#storage.put<R2ObjectMetadata>(key, {
      value: toStore,
      metadata,
    });
    // If existing value was multipart, remove its parts
    if (meta?.multipart !== undefined) {
      await deleteMultipartParts(this.#storage, key, meta.multipart.uploadId);
    }
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return new R2Object(metadata);
  }

  async delete(keys: string | string[]): Promise<void> {
    const ctx = this.#prepareCtx();

    // The Workers runtime will coerce keys to strings
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("delete"));
    }
    if (!Array.isArray(keys)) keys = [keys];
    keys = keys.map((key) => validateKey("DELETE", String(key)));

    await waitForOpenOutputGate();
    const keyMetas = await Promise.all(keys.map((key) => this.#head(key)));

    await this.#storage.deleteMany(keys);

    // If any existing values were multipart, remove their parts
    const deletePartsPromises = keys.map((key, i) => {
      const keyMeta = keyMetas[i];
      if (keyMeta?.multipart !== undefined) {
        return deleteMultipartParts(
          this.#storage,
          key,
          keyMeta.multipart.uploadId
        );
      }
    });
    await Promise.all(deletePartsPromises);

    await waitForOpenInputGate();

    ctx?.advanceCurrentTime();
  }

  async list(listOptions: R2ListOptions = {}): Promise<R2Objects> {
    const ctx = this.#prepareCtx();
    const delimitedPrefixes = new Set<string>();

    validateListOptions(listOptions);
    const { prefix = "", include = [], startAfter, cursor = "" } = listOptions;
    let { delimiter, limit = MAX_LIST_KEYS } = listOptions;
    if (delimiter === "") delimiter = undefined;

    // if include contains inputs, we reduce the limit to max 100
    if (include.length > 0) limit = Math.min(limit, 100);

    // the storage list implementation is *inclusive* of start
    // r2 implementation is *exclusive*
    // to avoid issues with limit count being wrong, we need to add 1
    if (startAfter !== undefined) limit++;

    const res = await this.#storage.list<R2ObjectMetadata>({
      prefix,
      excludePrefix: _INTERNAL_PREFIX,
      limit,
      cursor,
      start: startAfter,
      delimiter,
    });
    // add delimited prefixes should they exist
    for (const dP of res.delimitedPrefixes ?? []) delimitedPrefixes.add(dP);

    const objects = res.keys
      // grab metadata
      .map((k) => k.metadata)
      // filter out objects that exist within the delimiter
      .filter(
        (metadata): metadata is R2ObjectMetadata => metadata !== undefined
      )
      // filter "httpMetadata" and/or "customMetadata" if found in "include"
      .map((metadata) => {
        if (this.#listRespectInclude) {
          if (!include.includes("httpMetadata")) metadata.httpMetadata = {};
          if (!include.includes("customMetadata")) metadata.customMetadata = {};
        }
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

    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    const cursorLength = res.cursor.length > 0;
    return {
      objects,
      truncated: cursorLength,
      cursor: cursorLength ? res.cursor : undefined,
      delimitedPrefixes: [...delimitedPrefixes],
    };
  }

  async createMultipartUpload(
    key: string,
    options: R2MultipartOptions = {}
  ): Promise<R2MultipartUpload> {
    const ctx = this.#prepareCtx();

    // The Workers runtime will coerce the key parameter to a string
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("createMultipartUpload"));
    }
    key = String(key);
    validateMultipartKey("createMultipartUpload", key);

    // Validate options
    if (typeof options !== "object") {
      throw new TypeError(
        "Failed to execute 'createMultipartUpload' on 'R2Bucket': parameter 2 is not of type 'MultipartOptions'."
      );
    }
    if (
      options.customMetadata !== undefined &&
      typeof options.customMetadata !== "object"
    ) {
      throw new TypeError(
        "Incorrect type for the 'customMetadata' field on 'MultipartOptions': the provided value is not of type 'object'."
      );
    }
    if (
      options.httpMetadata !== undefined &&
      typeof options.httpMetadata !== "object"
    ) {
      throw new TypeError(
        "Incorrect type for the 'httpMetadata' field on 'MultipartOptions': the provided value is not of type 'HttpMetadata or Headers'."
      );
    }
    const customMetadata = options.customMetadata ?? {};
    const httpMetadata = parseHttpMetadata(options.httpMetadata);

    // Creating a multipart upload isn't observable so no need to wait on
    // output gate to open
    const upload = await createMultipartUpload(
      key,
      { customMetadata, httpMetadata },
      this.#multipartOpts
    );
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return upload;
  }

  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
    // The Workers runtime doesn't make a subrequest here, so no need to call
    // `prepareCtx()`

    // The Workers runtime will coerce key and uploadId parameters to a string
    if (arguments.length === 0) {
      throw new TypeError(buildKeyTypeError("resumeMultipartUpload"));
    }
    if (arguments.length === 1) {
      throw new TypeError(
        "Failed to execute 'resumeMultipartUpload' on 'R2Bucket': parameter 2 is not of type 'string'."
      );
    }
    key = String(key);
    uploadId = String(uploadId);

    return new R2MultipartUpload(key, uploadId, this.#multipartOpts);
  }
}
