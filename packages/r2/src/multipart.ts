// This file implements R2's multipart uploads. Multipart uploads are created
// and later resumed. When creating a multipart upload, Miniflare will store
// an "index", containing passed HTTP and custom metadata. This index serves
// as a marker for the upload, and is used by other methods to check the upload
// exists.
//
// A new key is stored for each uploaded part, in the same namespace as the
// upload's index. Each part gets an associated ETag, which must be used in
// conjunction with the part number when completing an upload. If a part is
// uploaded with the same part number as an existing part, it will override it.
//
// To complete an upload, an array of part number and ETag objects is required.
// Miniflare will then put a file in the regular location for the key containing
// pointers to the uploaded parts. This means Miniflare doesn't need to load
// all parts into memory, concatenate them, and write them back out. An upload
// can also be aborted, in which case all its parts will be deleted.
//
// Note that when completing or aborting an upload, the index is NOT deleted.
// This is because uploads can be aborted more than once, and even aborted after
// completion (although in this case, aborting is a no-op). We need to be able
// to distinguish between a completed upload, an aborted upload and an upload
// that never existed to handle this, and match R2's error messages.
//
// If regular `R2Bucket#{put,delete}()` methods are called on completed
// multipart keys, they will delete all parts in addition to the key itself.
// `R2Bucket#{head,get,list}()` will never return data from in-progress uploads.
//
// Unfortunately, Miniflare 2's storage abstraction is not very good at
// handling large data (doesn't support streaming reads/writes), or complex
// operations (doesn't support transactions). This limits the reliability of
// this multipart implementation, but it should still be useful for testing.
// We should aim to improve this in Miniflare 3.

import assert from "assert";
import { Blob } from "buffer";
import crypto from "crypto";
import { arrayBuffer } from "stream/consumers";
import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import { _isBodyStream, _isFixedLengthStream } from "@miniflare/core";
import {
  ParsedRange,
  RequestContext,
  Storage,
  assertInRequest,
  getRequestContext,
  viewToArray,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import {
  MAX_KEY_SIZE,
  R2MultipartReference,
  R2Object,
  R2ObjectMetadata,
  createMD5Hash,
  createVersion,
} from "./r2Object";

/** @internal */
export const _INTERNAL_PREFIX = "__MINIFLARE_INTERNAL__";

const MIN_MULTIPART_UPLOAD_SIZE = 5 * 1024 * 1024;

export interface R2UploadedPart {
  partNumber: number;
  etag: string;
}
export interface R2MultipartPendingIndexMetadata {
  httpMetadata: R2ObjectMetadata["httpMetadata"];
  customMetadata: R2ObjectMetadata["customMetadata"];
}
export type R2MultipartIndexMetadata =
  | R2MultipartPendingIndexMetadata
  | { aborted: true }
  | { completed: true };
interface R2MultipartPartMetadata {
  size: number;
  md5: string;
  etag: string;
}

type R2UploadState =
  | { exists: true; meta: R2MultipartPendingIndexMetadata }
  | { exists: false; aborted: boolean; completed: boolean };

const encoder = new TextEncoder();
export function validateMultipartKey(method: string, key: string) {
  if (
    Buffer.byteLength(key) > MAX_KEY_SIZE ||
    key.startsWith(_INTERNAL_PREFIX)
  ) {
    throw new TypeError(
      `${method}: The specified object name is not valid. (10020)`
    );
  }
}
function validatePartNumber(partNumber: number) {
  if (partNumber >= 1 && partNumber <= 10_000) return;
  throw new TypeError(
    `Part number must be between 1 and 10000 (inclusive). Actual value was: ${partNumber}`
  );
}

function generateId(likelyOnFilesystem = false) {
  // Windows has a maximum path length of ~260 characters:
  // https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
  // Miniflare R2 buckets will usually be backed by file-system storage,
  // especially when using multipart uploads for large files. Therefore, reduce
  // the size of the upload ID on Windows, preferring a longer ID otherwise
  // to more closely match R2 behaviour.
  const size = likelyOnFilesystem && process.platform === "win32" ? 32 : 128;
  return crypto.randomBytes(size).toString("base64url");
}
function generateMultipartEtag(md5Hexes: string[]) {
  // TODO: R2's multipart ETags don't seem to be deterministic, should ours be?
  // https://stackoverflow.com/a/19896823
  const hash = crypto.createHash("md5");
  for (const md5Hex of md5Hexes) hash.update(Buffer.from(md5Hex, "hex"));
  return `${hash.digest("hex")}-${md5Hexes.length}`;
}

const INDEX = "index";
function buildKey(key: string, uploadId: string, part?: number) {
  return `${_INTERNAL_PREFIX}:multipart:${uploadId}:${key}:${part ?? INDEX}`;
}

function isKnownLengthStream(stream: ReadableStream): boolean {
  return _isBodyStream(stream) || _isFixedLengthStream(stream);
}

export interface InternalR2MultipartUploadOptions {
  storage: Storage;
  blockGlobalAsyncIO?: boolean;
  minMultipartUploadSize?: number;
}
export async function createMultipartUpload(
  key: string,
  metadata: R2MultipartIndexMetadata,
  opts: InternalR2MultipartUploadOptions
): Promise<R2MultipartUpload> {
  const uploadId = generateId(/* likelyOnFilesystem */ true);
  const indexKey = buildKey(key, uploadId);
  await opts.storage.put<R2MultipartIndexMetadata>(indexKey, {
    value: new Uint8Array(),
    metadata,
  });
  return new R2MultipartUpload(key, uploadId, opts);
}

interface R2MultipartRange {
  /* inclusive */ start: number;
  /* exclusive */ end: number;
}
function overlaps(a: R2MultipartRange, b: R2MultipartRange): boolean {
  return a.start < b.end && b.start < a.end;
}
export function getMultipartValue(
  storage: Storage,
  key: string,
  multipart: R2MultipartReference,
  range: ParsedRange
): ReadableStream<Uint8Array> {
  // Convert from offset/length to start/end
  const queryRange: R2MultipartRange = {
    start: range.offset,
    end: range.offset + range.length,
  };

  // Find required parts (and the ranges within them) to satisfy the query
  const parts: ({ partNumber: number } & R2MultipartRange)[] = [];
  let start = 0;
  for (const part of multipart.parts) {
    const partRange: R2MultipartRange = { start, end: start + part.size };
    if (overlaps(partRange, queryRange)) {
      parts.push({
        partNumber: part.partNumber,
        start: Math.max(partRange.start, queryRange.start) - partRange.start,
        end: Math.min(partRange.end, queryRange.end) - partRange.start,
      });
    }
    start = partRange.end;
  }

  // Return a stream that fetches the parts lazily when required
  return new ReadableStream({
    type: "bytes",
    async pull(controller) {
      const part = parts.shift();
      if (part === undefined) {
        // If there are no more parts left, close the stream
        await waitForOpenInputGate();
        controller.close();
        // Not documented in MDN but if there's an ongoing request that's
        // waiting, we need to tell it that there were 0 bytes delivered so that
        // it unblocks and notices the end of stream.
        // @ts-expect-error `byobRequest` has type `undefined` in `@types/node`
        controller.byobRequest?.respond(0);
      } else {
        // Otherwise, fetch and enqueue the next part
        const partKey = buildKey(key, multipart.uploadId, part.partNumber);
        const value = await storage.getRange(
          partKey,
          { offset: part.start, length: part.end - part.start },
          /* skipMetadata */ true
        );
        assert(value !== undefined); // The part must exist
        await waitForOpenInputGate();
        if (value.value.byteLength > 0) controller.enqueue(value.value);
      }
    },
  });
}

export async function deleteMultipartParts(
  storage: Storage,
  key: string,
  uploadId: string,
  excludeKeys?: Set<string>
): Promise<void> {
  const indexKey = buildKey(key, uploadId);
  const partPrefix = indexKey.substring(0, indexKey.length - INDEX.length);
  const { keys } = await storage.list({ prefix: partPrefix });
  const partKeys: string[] = [];
  for (const key of keys) {
    if (
      key.name !== indexKey &&
      (excludeKeys === undefined || !excludeKeys.has(key.name))
    ) {
      partKeys.push(key.name);
    }
  }
  await storage.deleteMany(partKeys);
}

export class R2MultipartUpload {
  readonly #storage: Storage;
  readonly #blockGlobalAsyncIO: boolean;
  readonly #minMultipartUploadSize: number;

  readonly key!: string;
  readonly uploadId!: string;

  constructor(
    key: string,
    uploadId: string,
    opts: InternalR2MultipartUploadOptions
  ) {
    this.#storage = opts.storage;
    this.#blockGlobalAsyncIO = opts.blockGlobalAsyncIO ?? false;
    this.#minMultipartUploadSize =
      opts.minMultipartUploadSize ?? MIN_MULTIPART_UPLOAD_SIZE;

    // `key` and `uploadId` should be enumerable, readonly, instance properties:
    // https://github.com/cloudflare/workerd/blob/main/src/workerd/api/r2-multipart.h#L40-L41
    Object.defineProperties(this, {
      key: {
        enumerable: true,
        get() {
          return key;
        },
        set() {
          throw new TypeError(
            "Cannot assign to read only property 'key' of object '#<R2MultipartUpload>'"
          );
        },
      },
      uploadId: {
        enumerable: true,
        get() {
          return uploadId;
        },
        set() {
          throw new TypeError(
            "Cannot assign to read only property 'uploadId' of object '#<R2MultipartUpload>'"
          );
        },
      },
    });
  }

  #prepareCtx(): RequestContext | undefined {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementInternalSubrequests();
    return ctx;
  }

  async #state(): Promise<R2UploadState> {
    const meta = await this.#storage.head<R2MultipartIndexMetadata>(
      buildKey(this.key, this.uploadId)
    );
    if (meta?.metadata === undefined) {
      return { exists: false, aborted: false, completed: false };
    }
    if ("aborted" in meta.metadata) {
      return { exists: false, aborted: true, completed: false };
    }
    if ("completed" in meta.metadata) {
      return { exists: false, aborted: false, completed: true };
    }
    return { exists: true, meta: meta.metadata };
  }

  async uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
  ): Promise<R2UploadedPart> {
    const ctx = this.#prepareCtx();

    // 1. Validate and coerce parameters
    if (arguments.length === 0) {
      throw new TypeError(
        "Failed to execute 'uploadPart' on 'R2MultipartUpload': parameter 1 is not of type 'integer'."
      );
    }
    // noinspection SuspiciousTypeOfGuard
    if (typeof partNumber !== "number") {
      partNumber = parseInt(String(partNumber));
    }
    if (isNaN(partNumber)) partNumber = 0;

    let valueArray: Uint8Array;
    if (typeof value === "string") {
      valueArray = encoder.encode(value);
    } else if (value instanceof ArrayBuffer) {
      valueArray = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      valueArray = viewToArray(value);
    } else if (value instanceof Blob) {
      valueArray = new Uint8Array(await value.arrayBuffer());
    } else if (value instanceof ReadableStream) {
      if (!isKnownLengthStream(value)) {
        throw new TypeError(
          "Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)"
        );
      }
      // @ts-expect-error @types/node stream/consumers doesn't accept ReadableStream
      valueArray = new Uint8Array(await arrayBuffer(value));
    } else {
      throw new TypeError(
        "Failed to execute 'uploadPart' on 'R2MultipartUpload': parameter 2 is not of type 'ReadableStream or ArrayBuffer or ArrayBufferView or string or Blob'."
      );
    }

    validatePartNumber(partNumber);

    // 2. Make sure this multipart upload exists
    validateMultipartKey("uploadPart", this.key);
    if (!(await this.#state()).exists) {
      throw new Error(
        "uploadPart: The specified multipart upload does not exist. (10024)"
      );
    }

    // 3. Write part to storage
    const partKey = buildKey(this.key, this.uploadId, partNumber);
    const etag = generateId();
    // No need to wait for output gate here, as the user can't know the `etag`
    // before this function resolves, so this change isn't externally visible
    await this.#storage.put<R2MultipartPartMetadata>(partKey, {
      value: valueArray,
      metadata: {
        size: valueArray.byteLength,
        md5: createMD5Hash(valueArray),
        etag,
      },
    });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    return { partNumber, etag };
  }

  async abort(): Promise<void> {
    const ctx = this.#prepareCtx();

    // 1. Make sure this multipart upload exists, ignoring the finalised state
    validateMultipartKey("abortMultipartUpload", this.key);
    const state = await this.#state();
    if (!state.exists) {
      if (state.aborted || state.completed) {
        // If this upload has already been finalised, return here. `abort()` can
        // be called multiple times, and on already `complete()`ed uploads. In
        // the later case, we really don't want to delete pointed-to parts.
        await waitForOpenInputGate();
        ctx?.advanceCurrentTime();
        return;
      } else {
        throw new Error(
          "abortMultipartUpload: We encountered an internal error. Please try again. (10001)"
        );
      }
    }

    // 3. Delete all parts, excluding the index
    // No need to wait for output gate here, as we're just deleting hidden
    // internal parts, so this change isn't externally visible
    await deleteMultipartParts(this.#storage, this.key, this.uploadId);

    // 4. Mark upload as aborted
    const indexKey = buildKey(this.key, this.uploadId);
    await this.#storage.put<R2MultipartIndexMetadata>(indexKey, {
      value: new Uint8Array(),
      metadata: { aborted: true },
    });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
  }

  async complete(uploadedParts: R2UploadedPart[]): Promise<R2Object> {
    const ctx = this.#prepareCtx();

    // 1. Validate and coerce parameters
    if (!Array.isArray(uploadedParts)) {
      throw new TypeError(
        "Failed to execute 'complete' on 'R2MultipartUpload': parameter 1 is not of type 'Array'."
      );
    }
    uploadedParts = uploadedParts.map((part, i) => {
      if (typeof part !== "object") {
        throw new TypeError(
          `Incorrect type for array element ${i}: the provided value is not of type 'UploadedPart'.`
        );
      }
      // Create new part object, so we don't mutate parameters when coercing
      part = { partNumber: part.partNumber, etag: part.etag };
      // noinspection SuspiciousTypeOfGuard
      if (typeof part.partNumber !== "number") {
        part.partNumber = parseInt(String(part.partNumber));
      }
      if (isNaN(part.partNumber)) part.partNumber = 0;

      part.etag = String(part.etag);

      return part;
    });
    for (const part of uploadedParts) {
      validatePartNumber(part.partNumber);
    }

    // 2. Make sure this multipart upload exists
    validateMultipartKey("completeMultipartUpload", this.key);
    const state = await this.#state();
    if (!state.exists) {
      throw new Error(
        state.completed
          ? "completeMultipartUpload: The specified multipart upload does not exist. (10024)"
          : "completeMultipartUpload: We encountered an internal error. Please try again. (10001)"
      );
    }

    // 3. Make sure all part numbers are unique
    const partNumberSet = new Set<number>();
    for (const { partNumber } of uploadedParts) {
      if (partNumberSet.has(partNumber)) {
        throw new Error(
          "completeMultipartUpload: We encountered an internal error. Please try again. (10001)"
        );
      }
      partNumberSet.add(partNumber);
    }

    // 4. Get metadata for all parts, checking they all exist
    const partMetas = await Promise.all(
      uploadedParts.map(({ partNumber }) => {
        const partKey = buildKey(this.key, this.uploadId, partNumber);
        return this.#storage.head<R2MultipartPartMetadata>(partKey);
      })
    );
    const parts = partMetas.map((partMeta, i) => {
      const uploadedPart = uploadedParts[i];
      if (
        partMeta?.metadata === undefined ||
        partMeta.metadata.etag !== uploadedPart.etag
      ) {
        throw new Error(
          "completeMultipartUpload: One or more of the specified parts could not be found. (10025)"
        );
      }
      // Note both `uploadedPart` and `partMeta.metadata` have an `etag` field,
      // but we've just validated they're the same
      return { ...uploadedPart, ...partMeta.metadata };
    });

    // 5. Check all but last part meets minimum size requirements. First check
    //    the in argument order, throwing a friendly error...
    for (const part of parts.slice(0, -1)) {
      if (part.size < this.#minMultipartUploadSize) {
        throw new Error(
          "completeMultipartUpload: Your proposed upload is smaller than the minimum allowed object size."
        );
      }
    }
    //   ...then check again in ascending `partNumber` order, throwing an
    //   internal error. We won't know where the current last element ends
    //   up in the sort, so we just check all parts again.
    //
    //   Also check that all but last parts are the same size...
    parts.sort((a, b) => a.partNumber - b.partNumber);
    let partSize: number | undefined;
    for (const part of parts.slice(0, -1)) {
      if (partSize === undefined) partSize = part.size;
      if (part.size < this.#minMultipartUploadSize || part.size !== partSize) {
        throw new Error(
          "completeMultipartUpload: There was a problem with the multipart upload. (10048)"
        );
      }
    }
    //   ...and the last part is not greater than all others
    //   (if part size is defined, we must have at least one part)
    if (partSize !== undefined && parts[parts.length - 1].size > partSize) {
      throw new Error(
        "completeMultipartUpload: There was a problem with the multipart upload. (10048)"
      );
    }

    // 6. Write key to storage with pointers to parts, and mark upload as
    //    completed
    const existingMeta = await this.#storage.head<R2ObjectMetadata>(this.key);
    const indexKey = buildKey(this.key, this.uploadId);
    const totalSize = parts.reduce((acc, { size }) => acc + size, 0);
    const etag = generateMultipartEtag(parts.map(({ md5 }) => md5));
    const metadata: R2ObjectMetadata = {
      key: this.key,
      version: createVersion(),
      size: totalSize,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(),
      httpMetadata: state.meta.httpMetadata,
      customMetadata: state.meta.customMetadata,
      checksums: {},
      multipart: {
        uploadId: this.uploadId,
        parts: parts.map(({ partNumber, size }) => ({ partNumber, size })),
      },
    };
    await waitForOpenOutputGate();
    await this.#storage.putMany<R2ObjectMetadata | R2MultipartIndexMetadata>([
      [this.key, { value: new Uint8Array(), metadata }],
      [indexKey, { value: new Uint8Array(), metadata: { completed: true } }],
    ]);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();

    // 7. Cleanup redundant parts
    //    a) If we didn't use all upload parts, remove the unused
    const used = new Set(
      parts.map(({ partNumber }) =>
        buildKey(this.key, this.uploadId, partNumber)
      )
    );
    await deleteMultipartParts(this.#storage, this.key, this.uploadId, used);
    //   b) If we had an existing multipart key, remove all its parts
    if (existingMeta?.metadata?.multipart !== undefined) {
      await deleteMultipartParts(
        this.#storage,
        this.key,
        existingMeta.metadata.multipart.uploadId
      );
    }

    // Note metadata is empty in objects returned from `complete()`, this feels
    // like a bug...
    return new R2Object(metadata);
  }
}
