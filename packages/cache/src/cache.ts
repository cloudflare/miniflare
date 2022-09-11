import { URL } from "url";
import {
  Request,
  RequestInfo,
  Response,
  withImmutableHeaders,
  withStringFormDataFiles,
} from "@miniflare/core";
import {
  Clock,
  SITES_NO_CACHE_PREFIX,
  Storage,
  assertInRequest,
  defaultClock,
  getRequestContext,
  millisToSeconds,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import CachePolicy from "http-cache-semantics";
import {
  Request as BaseRequest,
  Response as BaseResponse,
  Headers,
} from "undici";
import { CacheError } from "./error";
import { CacheInterface, CacheMatchOptions, CachedMeta } from "./helpers";

function normaliseRequest(req: RequestInfo): BaseRequest | Request {
  // noinspection SuspiciousTypeOfGuard
  return req instanceof Request || req instanceof BaseRequest
    ? req
    : new Request(req);
}

// Normalises headers to object mapping lower-case names to single values.
// Single values are OK here as the headers we care about for determining
// cache-ability are all single-valued, and we store the raw, multi-valued
// headers in KV once this has been determined.
function normaliseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers) result[key.toLowerCase()] = value;
  return result;
}

function getKey(req: BaseRequest | Request): string {
  // @ts-expect-error cf doesn't exist on BaseRequest, but we're using `?.`
  if (req.cf?.cacheKey) return req.cf.cacheKey;
  try {
    const url = new URL(req.url);
    return url.toString();
  } catch (e) {
    throw new TypeError(
      "Invalid URL. Cache API keys must be fully-qualified, valid URLs."
    );
  }
}

function getExpirationTtl(
  clock: Clock,
  req: BaseRequest | Request,
  res: BaseResponse | Response
): number | undefined {
  // Cloudflare ignores request Cache-Control
  const reqHeaders = normaliseHeaders(req.headers);
  delete reqHeaders["cache-control"];

  // Cloudflare never caches responses with Set-Cookie headers
  // If Cache-Control contains private=set-cookie, Cloudflare will remove
  // the Set-Cookie header automatically
  const resHeaders = normaliseHeaders(res.headers);
  if (
    resHeaders["cache-control"]?.toLowerCase().includes("private=set-cookie")
  ) {
    resHeaders["cache-control"] = resHeaders["cache-control"].replace(
      /private=set-cookie/i,
      ""
    );
    delete resHeaders["set-cookie"];
  }

  // Build request and responses suitable for CachePolicy
  const cacheReq: CachePolicy.Request = {
    url: req.url,
    method: req.method,
    headers: reqHeaders,
  };
  const cacheRes: CachePolicy.Response = {
    status: res.status,
    headers: resHeaders,
  };

  // @ts-expect-error `now` isn't included in CachePolicy's type definitions
  const originalNow = CachePolicy.prototype.now;
  // @ts-expect-error `now` isn't included in CachePolicy's type definitions
  CachePolicy.prototype.now = clock;
  try {
    const policy = new CachePolicy(cacheReq, cacheRes, { shared: true });

    // Check if the request & response is cacheable, if not return undefined
    if ("set-cookie" in resHeaders || !policy.storable()) {
      return;
    }

    return policy.timeToLive();
  } finally {
    // @ts-expect-error `now` isn't included in CachePolicy's type definitions
    CachePolicy.prototype.now = originalNow;
  }
}

export interface InternalCacheOptions {
  formDataFiles?: boolean;
  clock?: Clock;
  blockGlobalAsyncIO?: boolean;
}

export class Cache implements CacheInterface {
  readonly #storage: Storage;
  readonly #formDataFiles: boolean;
  readonly #clock: Clock;
  readonly #blockGlobalAsyncIO: boolean;

  constructor(
    storage: Storage,
    {
      formDataFiles = true,
      clock = defaultClock,
      blockGlobalAsyncIO = false,
    }: InternalCacheOptions = {}
  ) {
    this.#storage = storage;
    this.#formDataFiles = formDataFiles;
    this.#clock = clock;
    this.#blockGlobalAsyncIO = blockGlobalAsyncIO;
  }

  async put(
    req: RequestInfo,
    res: BaseResponse | Response
  ): Promise<undefined> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementExternalSubrequests();
    req = normaliseRequest(req);

    if (res instanceof Response && res.webSocket) {
      throw new TypeError("Cannot cache WebSocket upgrade response.");
    }
    if (req.method !== "GET") {
      throw new TypeError("Cannot cache response to non-GET request.");
    }
    if (res.status === 206) {
      throw new TypeError(
        "Cannot cache response to a range request (206 Partial Content)."
      );
    }
    if (res.headers.get("vary")?.includes("*")) {
      throw new TypeError("Cannot cache response with 'Vary: *' header.");
    }

    // Disable caching of Workers Sites files, so we always serve the latest
    // version from disk
    const url = new URL(req.url);
    if (url.pathname.startsWith("/" + SITES_NO_CACHE_PREFIX)) return;

    // Check if response cacheable and get expiration TTL if any
    const expirationTtl = getExpirationTtl(this.#clock, req, res);
    if (expirationTtl === undefined) return;

    // If it is cacheable, store it
    const key = getKey(req);
    const metadata: CachedMeta = {
      status: res.status,
      headers: [...res.headers],
    };
    await waitForOpenOutputGate();
    await this.#storage.put(key, {
      value: new Uint8Array(await res.arrayBuffer()),
      expiration: millisToSeconds(this.#clock() + expirationTtl),
      metadata,
    });
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
  }

  async match(
    req: RequestInfo,
    options?: CacheMatchOptions
  ): Promise<Response | undefined> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementExternalSubrequests();
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" && !options?.ignoreMethod) return;

    // Check if we have the response cached
    const key = getKey(req);
    const cached = await this.#storage.get<CachedMeta>(key);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    if (!cached) return;

    // Check we're not trying to load cached data created in Miniflare 1.
    // All cached responses should have metadata set as it includes the status.
    if (!cached.metadata) {
      throw new CacheError(
        "ERR_DESERIALIZATION",
        "Unable to deserialize stored cached data due to missing " +
          "metadata.\nThe cached data storage format changed in Miniflare 2. " +
          "You cannot load cached data created with Miniflare 1 and must " +
          "delete it."
      );
    }

    // Build Response from cache
    const headers = new Headers(cached.metadata.headers);
    headers.set("CF-Cache-Status", "HIT");
    // Returning a @miniflare/core Response so we don't need to convert
    // BaseResponse to one when dispatching fetch events
    let res = new Response(cached.value, {
      status: cached.metadata.status,
      headers,
    });
    if (!this.#formDataFiles) res = withStringFormDataFiles(res);
    return withImmutableHeaders(res);
  }

  async delete(
    req: RequestInfo,
    options?: CacheMatchOptions
  ): Promise<boolean> {
    if (this.#blockGlobalAsyncIO) assertInRequest();
    const ctx = getRequestContext();
    ctx?.incrementExternalSubrequests();
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" && !options?.ignoreMethod) return false;

    // Delete the cached response if it exists
    const key = getKey(req);
    await waitForOpenOutputGate();
    const result = this.#storage.delete(key);
    await waitForOpenInputGate();
    ctx?.advanceCurrentTime();
    return result;
  }
}
