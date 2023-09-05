import assert from "node:assert";
import {
  DELETE,
  DeferredPromise,
  GET,
  HttpError,
  KeyValueStorage,
  MiniflareDurableObject,
  PUT,
  RouteHandler,
  maybeApply,
} from "miniflare:shared";
import { KVHeaders, KVLimits, KVParams } from "./constants";
import {
  decodeKey,
  decodeListOptions,
  validateGetOptions,
  validateKey,
  validateListOptions,
  validatePutOptions,
} from "./validator.worker";

interface KVParams {
  key: string;
}

function createMaxValueSizeError(length: number, maxValueSize: number) {
  return new HttpError(
    413,
    `Value length of ${length} exceeds limit of ${maxValueSize}.`
  );
}
class MaxLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  readonly signal: AbortSignal;
  readonly length: Promise<number>;

  constructor(maxLength: number) {
    const abortController = new AbortController();
    const lengthPromise = new DeferredPromise<number>();

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
        lengthPromise.resolve(length);
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
    // Decode URL parameters and headers
    const key = decodeKey(params, url.searchParams);
    const rawExpiration = url.searchParams.get(KVParams.EXPIRATION);
    const rawExpirationTtl = url.searchParams.get(KVParams.EXPIRATION_TTL);
    const rawMetadata = req.headers.get(KVHeaders.METADATA);

    // Validate key, expiration and metadata
    const now = millisToSeconds(this.timers.now());
    const { expiration, metadata } = validatePutOptions(key, {
      now,
      rawExpiration,
      rawExpirationTtl,
      rawMetadata,
    });

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

    const maxValueSize = this.beingTested
      ? KVLimits.MAX_VALUE_SIZE_TEST
      : KVLimits.MAX_VALUE_SIZE;
    let maxLengthStream: MaxLengthStream | undefined;
    if (valueLengthHint !== undefined && valueLengthHint > maxValueSize) {
      // If we know the size of the value (i.e. from `Content-Length`) use that
      throw createMaxValueSizeError(valueLengthHint, maxValueSize);
    } else {
      // Otherwise, pipe through a transform stream that counts the number of
      // bytes and stops if it exceeds the max. The stream exposes an
      // `AbortSignal`, that will be aborted when the max is exceeded.
      maxLengthStream = new MaxLengthStream(maxValueSize);
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
        throw createMaxValueSizeError(length, maxValueSize);
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
