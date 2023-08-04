import assert from "node:assert";
import { Buffer } from "node:buffer";
import { maybeApply } from "../shared";
import { KeyValueStorage } from "../shared/keyvalue.worker";
import { MiniflareDurableObject } from "../shared/object.worker";
import {
  DELETE,
  GET,
  HttpError,
  PUT,
  RouteHandler,
} from "../shared/router.worker";
import { KVHeaders, KVLimits, KVParams } from "./constants";

interface KVParams {
  key: string;
}

function decodeKey({ key }: KVParams, query: URLSearchParams) {
  if (query.get(KVParams.URL_ENCODED)?.toLowerCase() !== "true") return key;
  try {
    return decodeURIComponent(key);
  } catch (e: any) {
    if (e instanceof URIError) {
      throw new HttpError(400, "Could not URL-decode key name");
    } else {
      throw e;
    }
  }
}

function validateKey(key: string): void {
  if (key === "") {
    throw new HttpError(400, "Key names must not be empty");
  }
  if (key === "." || key === "..") {
    throw new HttpError(
      400,
      `Illegal key name "${key}". Please use a different name.`
    );
  }
  validateKeyLength(key);
}

function validateKeyLength(key: string): void {
  const keyLength = Buffer.byteLength(key);
  if (keyLength > KVLimits.MAX_KEY_SIZE) {
    throw new HttpError(
      414,
      `UTF-8 encoded length of ${keyLength} exceeds key length limit of ${KVLimits.MAX_KEY_SIZE}.`
    );
  }
}

export function validateGetOptions(
  key: string,
  options?: Omit<KVNamespaceGetOptions<never>, "type">
): void {
  validateKey(key);
  // Validate cacheTtl, but ignore it as there's only one "edge location":
  // the user's computer
  const cacheTtl = options?.cacheTtl;
  if (
    cacheTtl !== undefined &&
    (isNaN(cacheTtl) || cacheTtl < KVLimits.MIN_CACHE_TTL)
  ) {
    throw new HttpError(
      400,
      `Invalid ${KVParams.CACHE_TTL} of ${cacheTtl}. Cache TTL must be at least ${KVLimits.MIN_CACHE_TTL}.`
    );
  }
}

export function decodeListOptions(url: URL) {
  const limitParam = url.searchParams.get(KVParams.LIST_LIMIT);
  const limit =
    limitParam === null ? KVLimits.MAX_LIST_KEYS : parseInt(limitParam);
  const prefix = url.searchParams.get(KVParams.LIST_PREFIX) ?? undefined;
  const cursor = url.searchParams.get(KVParams.LIST_CURSOR) ?? undefined;
  return { limit, prefix, cursor };
}

export function validateListOptions(options: KVNamespaceListOptions): void {
  // Validate key limit
  const limit = options.limit;
  if (limit !== undefined) {
    if (isNaN(limit) || limit < 1) {
      throw new HttpError(
        400,
        `Invalid ${KVParams.LIST_LIMIT} of ${limit}. Please specify an integer greater than 0.`
      );
    }
    if (limit > KVLimits.MAX_LIST_KEYS) {
      throw new HttpError(
        400,
        `Invalid ${KVParams.LIST_LIMIT} of ${limit}. Please specify an integer less than ${KVLimits.MAX_LIST_KEYS}.`
      );
    }
  }

  // Validate key prefix
  const prefix = options.prefix;
  if (prefix != null) validateKeyLength(prefix);
}

// Returns value as an integer or undefined if it isn't one
function normaliseInt(value: string | number | undefined): number | undefined {
  switch (typeof value) {
    case "string":
      return parseInt(value);
    case "number":
      return Math.round(value);
  }
}

function createMaxValueSizeError(length: number) {
  return new HttpError(
    413,
    `Value length of ${length} exceeds limit of ${KVLimits.MAX_VALUE_SIZE}.`
  );
}
class MaxLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  readonly signal: AbortSignal;
  readonly length: Promise<number>;

  constructor(maxLength: number) {
    const abortController = new AbortController();
    let lengthResolve: (length: number) => void;
    const lengthPromise = new Promise<number>(
      (resolve) => (lengthResolve = resolve)
    );

    let length = 0;
    super({
      transform(chunk, controller) {
        length += chunk.byteLength;
        // If we exceeded the maximum length, don't enqueue the chunk, but don't
        // error the stream, so we get the correct final length in the error
        if (length <= maxLength) {
          controller.enqueue(chunk);
        } else if (!abortController.signal.aborted) {
          abortController.abort();
        }
      },
      flush() {
        // Previously, when this was running in Node, we `error()`ed the stream
        // here, and relied on the abort reason being propagated from the blob
        // store put to the HTTP handler. Now that we're running in `workerd`,
        // we have to use `fetch()` for file-system access, which throws an
        // un-catchable exception when the body stream is aborted.
        lengthResolve(length);
      },
    });

    this.signal = abortController.signal;
    this.length = lengthPromise;
  }
}

function millisToSeconds(millis: number): number {
  return Math.floor(millis / 1000);
}

function secondsToMillis(seconds: number): number {
  return seconds * 1000;
}

export class KVNamespaceObject extends MiniflareDurableObject {
  #storage?: KeyValueStorage;
  get storage() {
    // `KeyValueStorage` can only be constructed once `this.blob` is initialised
    return (this.#storage ??= new KeyValueStorage(this));
  }

  @GET("/:key")
  get: RouteHandler<KVParams> = async (req, params, url) => {
    // Decode URL parameters
    const key = decodeKey(params, url.searchParams);
    const cacheTtlParam = url.searchParams.get(KVParams.CACHE_TTL);
    const cacheTtl =
      cacheTtlParam === null ? undefined : parseInt(cacheTtlParam);

    // Get value from storage
    validateGetOptions(key, { cacheTtl });
    const entry = await this.storage.get(key);
    if (entry === null) throw new HttpError(404, "Not Found");

    // Return value in runtime-friendly format
    const headers = new Headers();
    if (entry.expiration !== undefined) {
      headers.set(
        KVHeaders.EXPIRATION,
        millisToSeconds(entry.expiration).toString()
      );
    }
    if (entry.metadata !== undefined) {
      headers.set(KVHeaders.METADATA, JSON.stringify(entry.metadata));
    }
    return new Response(entry.value, { headers });
  };

  @PUT("/:key")
  put: RouteHandler<KVParams> = async (req, params, url) => {
    // Decode URL parameters
    const key = decodeKey(params, url.searchParams);
    const expirationParam =
      url.searchParams.get(KVParams.EXPIRATION) ?? undefined;
    const expirationTtlParam =
      url.searchParams.get(KVParams.EXPIRATION_TTL) ?? undefined;

    // Parse metadata if set
    const metadataHeader = req.headers.get(KVHeaders.METADATA);
    const metadata =
      metadataHeader === null ? undefined : JSON.parse(metadataHeader);

    validateKey(key);

    // Normalise and validate expiration
    const now = millisToSeconds(this.timers.now());
    let expiration = normaliseInt(expirationParam);
    const expirationTtl = normaliseInt(expirationTtlParam);
    if (expirationTtl !== undefined) {
      if (isNaN(expirationTtl) || expirationTtl <= 0) {
        throw new HttpError(
          400,
          `Invalid ${KVParams.EXPIRATION_TTL} of ${expirationTtlParam}. Please specify integer greater than 0.`
        );
      }
      if (expirationTtl < KVLimits.MIN_CACHE_TTL) {
        throw new HttpError(
          400,
          `Invalid ${KVParams.EXPIRATION_TTL} of ${expirationTtlParam}. Expiration TTL must be at least ${KVLimits.MIN_CACHE_TTL}.`
        );
      }
      expiration = now + expirationTtl;
    } else if (expiration !== undefined) {
      if (isNaN(expiration) || expiration <= now) {
        throw new HttpError(
          400,
          `Invalid ${KVParams.EXPIRATION} of ${expirationParam}. Please specify integer greater than the current number of seconds since the UNIX epoch.`
        );
      }
      if (expiration < now + KVLimits.MIN_CACHE_TTL) {
        throw new HttpError(
          400,
          `Invalid ${KVParams.EXPIRATION} of ${expirationParam}. Expiration times must be at least ${KVLimits.MIN_CACHE_TTL} seconds in the future.`
        );
      }
    }

    // Validate metadata size
    if (metadata !== undefined) {
      assert(metadataHeader !== null);
      const metadataLength = Buffer.byteLength(metadataHeader);
      if (metadataLength > KVLimits.MAX_METADATA_SIZE) {
        throw new HttpError(
          413,
          `Metadata length of ${metadataLength} exceeds limit of ${KVLimits.MAX_METADATA_SIZE}.`
        );
      }
    }

    // Validate value size: if we know the value length, avoid passing the body
    // through a transform stream to count it (trusting `workerd` to send
    // correct value here).
    // Safety of `!`: `parseInt(null)` is `NaN`
    let value = req.body;
    assert(value !== null);
    const contentLength = parseInt(req.headers.get("Content-Length")!);
    const valueLengthHint = Number.isNaN(contentLength)
      ? undefined
      : contentLength;

    let maxLengthStream: MaxLengthStream | undefined;
    if (
      valueLengthHint !== undefined &&
      valueLengthHint > KVLimits.MAX_VALUE_SIZE
    ) {
      // If we know the size of the value (i.e. from `Content-Length`) use that
      throw createMaxValueSizeError(valueLengthHint);
    } else {
      // Otherwise, pipe through a transform stream that counts the number of
      // bytes and stops if it exceeds the max. The stream exposes an
      // `AbortSignal`, that will be aborted when the max is exceeded.
      maxLengthStream = new MaxLengthStream(KVLimits.MAX_VALUE_SIZE);
      value = value.pipeThrough(maxLengthStream);
    }

    // Put value into storage
    try {
      await this.storage.put({
        key,
        value,
        expiration: maybeApply(secondsToMillis, expiration),
        metadata,
        signal: maxLengthStream?.signal,
      });
    } catch (e) {
      if (
        typeof e === "object" &&
        e !== null &&
        "name" in e &&
        e.name === "AbortError"
      ) {
        // `this.storage.put()` will only throw an abort error once the stream
        // has been written to the blob store (it gets cleaned up afterwards),
        // so we have the correct value length here.
        assert(maxLengthStream !== undefined);
        const length = await maxLengthStream.length;
        throw createMaxValueSizeError(length);
      } else {
        throw e;
      }
    }

    return new Response();
  };

  @DELETE("/:key")
  delete: RouteHandler<KVParams> = async (req, params, url) => {
    // Decode URL parameters
    const key = decodeKey(params, url.searchParams);
    validateKey(key);

    // Delete key from storage
    await this.storage.delete(key);
    return new Response();
  };

  @GET("/")
  list: RouteHandler = async (req, params, url) => {
    // Decode URL parameters
    const options = decodeListOptions(url);
    validateListOptions(options);

    // List keys from storage
    const res = await this.storage.list(options);
    const keys = res.keys.map<KVNamespaceListKey<unknown>>((key) => ({
      name: key.key,
      expiration: maybeApply(millisToSeconds, key.expiration),
      // workerd expects metadata to be a JSON-serialised string
      metadata: maybeApply(JSON.stringify, key.metadata),
    }));
    let result: KVNamespaceListResult<unknown>;
    if (res.cursor === undefined) {
      result = { keys, list_complete: true, cacheStatus: null };
    } else {
      result = {
        keys,
        list_complete: false,
        cursor: res.cursor,
        cacheStatus: null,
      };
    }
    return Response.json(result);
  };
}
