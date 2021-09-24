import { URL } from "url";
import { Request, RequestInfo, Response } from "@miniflare/core";
import {
  Clock,
  MaybePromise,
  StorageOperator,
  defaultClock,
  millisToSeconds,
} from "@miniflare/shared";
import CachePolicy from "http-cache-semantics";
import {
  Request as BaseRequest,
  Response as BaseResponse,
  Headers,
} from "undici";
import { CacheInterface, CacheMatchOptions, CachedMeta } from "./helpers";

function normaliseRequest(req: RequestInfo): BaseRequest {
  return req instanceof BaseRequest ? req : new Request(req);
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

function getKey(req: BaseRequest): string {
  try {
    // TODO: support request cacheKey
    const url = new URL(req.url);
    return url.toString();
  } catch (e) {
    throw new TypeError(
      "Invalid URL. Cache API keys must be fully-qualified, valid URLs."
    );
  }
}

const kStorage = Symbol("kStorage");
const kClock = Symbol("kClock");

export class Cache implements CacheInterface {
  private readonly [kStorage]: MaybePromise<StorageOperator>;
  private readonly [kClock]: Clock;

  constructor(storage: MaybePromise<StorageOperator>, clock = defaultClock) {
    this[kStorage] = storage;
    this[kClock] = clock;
  }

  async put(
    req: RequestInfo,
    res: BaseResponse | Response
  ): Promise<undefined> {
    req = normaliseRequest(req);

    if (res instanceof Response && res.webSocket) {
      throw new TypeError("Cannot cache WebSocket upgrade response.");
    }
    if (req.method === "GET") {
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
    CachePolicy.prototype.now = this[kClock];
    let expirationTtl: number;
    try {
      const policy = new CachePolicy(cacheReq, cacheRes, { shared: true });

      // Check if the request & response is cacheable, if not return undefined
      if ("set-cookie" in resHeaders || !policy.storable()) {
        return;
      }

      expirationTtl = policy.timeToLive();
    } finally {
      // @ts-expect-error `now` isn't included in CachePolicy's type definitions
      CachePolicy.prototype.now = originalNow;
    }

    // If it is cacheable, store it in KV
    const key = getKey(req);
    const metadata: CachedMeta = {
      status: res.status,
      headers: [...res.headers],
    };
    const storage = await this[kStorage];
    await storage.put(key, {
      value: new Uint8Array(await res.arrayBuffer()),
      expiration: millisToSeconds(this[kClock]() + expirationTtl),
      metadata,
    });
  }

  async match(
    req: RequestInfo,
    options?: CacheMatchOptions
  ): Promise<Response | undefined> {
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" && !options?.ignoreMethod) return;

    // Check if we have the response cached
    const key = getKey(req);
    const storage = await this[kStorage];
    const cached = await storage.get<CachedMeta>(key);
    if (!cached) return;

    // Build Response from cache
    const headers = new Headers(cached.metadata?.headers);
    headers.set("CF-Cache-Status", "HIT");
    // Returning a @miniflare/core Response so we don't need to convert
    // BaseResponse to one when dispatching fetch events
    return new Response(cached.value, {
      status: cached.metadata?.status,
      headers,
    });
  }

  async delete(
    req: RequestInfo,
    options?: CacheMatchOptions
  ): Promise<boolean> {
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" && !options?.ignoreMethod) return false;

    // Delete the cached response if it exists
    const key = getKey(req);
    const storage = await this[kStorage];
    return storage.delete(key);
  }
}
