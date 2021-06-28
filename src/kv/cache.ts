import { Headers, Request, Response } from "@mrbbot/node-fetch";
import CachePolicy from "http-cache-semantics";
import { KVClock, defaultClock } from "./helpers";
import { KVStorageNamespace } from "./namespace";
import { KVStorage } from "./storage";

export interface CacheMatchOptions {
  // Consider the request's method GET, regardless of its actual value
  // TODO: check we actually want this, does cloudflare have it?
  ignoreMethod?: boolean;
}

export interface CachedResponse {
  status: number;
  headers: Record<string, string[]>;
  body: string;
}

function normaliseRequest(req: string | Request): Request {
  return typeof req === "string" ? new Request(req) : req;
}

function normaliseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  // TODO: test this with multi-valued headers, may need to use `headers.raw()` instead
  for (const [key, value] of headers) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

function getKey(req: Request): string {
  return `${req.url}.json`;
}

// TODO: make sure to test url key sanitization
// TODO: may need to add Cf-Cache-Status headers, check in actual workers environment
export class Cache {
  readonly #storage: KVStorage;
  readonly #clock: KVClock;
  readonly #namespace: KVStorageNamespace;

  constructor(storage: KVStorage, clock: KVClock = defaultClock) {
    this.#storage = storage;
    this.#clock = clock;
    this.#namespace = new KVStorageNamespace(storage, clock);
  }

  async put(req: string | Request, res: Response): Promise<undefined> {
    req = normaliseRequest(req);

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
    CachePolicy.prototype.now = this.#clock;
    let expirationTtl: number;
    try {
      const policy = new CachePolicy(cacheReq, cacheRes, { shared: true });

      // Check if the request & response is cacheable, if not return undefined
      if (
        req.method !== "GET" ||
        "set-cookie" in resHeaders ||
        !policy.storable()
      ) {
        return;
      }

      expirationTtl = policy.timeToLive() / 1000;
    } finally {
      // @ts-expect-error `now` isn't included in CachePolicy's type definitions
      CachePolicy.prototype.now = originalNow;
    }

    // If it is cacheable, store it in KV
    const key = getKey(req);
    await this.#namespace.put(
      key,
      JSON.stringify({
        status: res.status,
        headers: res.headers.raw(),
        body: Buffer.from(await res.arrayBuffer()).toString("base64"),
      } as CachedResponse),
      { expirationTtl }
    );
  }

  async match(
    req: string | Request,
    options?: CacheMatchOptions
  ): Promise<Response | undefined> {
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" || options?.ignoreMethod) return;

    // Check if we have the response cached
    const key = getKey(req);
    const res = await this.#namespace.get<CachedResponse>(key, "json");
    if (!res) return;

    // Build Response from cache
    const headers = new Headers();
    for (const [key, values] of Object.entries(res.headers)) {
      for (const value of values) {
        headers.append(key, value);
      }
    }
    return new Response(Buffer.from(res.body, "base64"), {
      status: res.status,
      headers: res.headers,
    });
  }

  async delete(
    req: string | Request,
    options?: CacheMatchOptions
  ): Promise<boolean> {
    req = normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" || options?.ignoreMethod) return false;

    // Delete the cached response if it exists (we delete from this.storage not
    // this.namespace since we need to know whether we deleted something)
    const key = getKey(req);
    return this.#storage.delete(key);
  }
}
