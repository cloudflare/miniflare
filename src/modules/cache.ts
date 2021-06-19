import path from "path";
import { Headers, Request, Response } from "@mrbbot/node-fetch";
import CachePolicy from "http-cache-semantics";
import { KVStorage, KVStorageNamespace } from "../kv";
import { KVStorageFactory, sanitise } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

const defaultPersistRoot = path.resolve(".mf", "cache");

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

// TODO: make sure to test url key sanitization
// TODO: may need to add Cf-Cache-Status headers, check in actual workers environment
export class Cache {
  private readonly namespace: KVStorageNamespace;

  constructor(private storage: KVStorage) {
    this.namespace = new KVStorageNamespace(storage);
  }

  private static _normaliseRequest(req: string | Request): Request {
    return typeof req === "string" ? new Request(req) : req;
  }

  private static _normaliseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    // TODO: test this with multi-valued headers, may need to use `headers.raw()` instead
    for (const [key, value] of headers) {
      result[key.toLowerCase()] = value;
    }
    return result;
  }

  private static _getKey(req: Request) {
    return `${sanitise(req.url)}.json`;
  }

  async put(req: string | Request, res: Response): Promise<undefined> {
    req = Cache._normaliseRequest(req);

    // Cloudflare ignores request Cache-Control
    const reqHeaders = Cache._normaliseHeaders(req.headers);
    delete reqHeaders["cache-control"];

    // Cloudflare never caches responses with Set-Cookie headers
    // If Cache-Control contains private=set-cookie, Cloudflare will remove
    // the Set-Cookie header automatically
    const resHeaders = Cache._normaliseHeaders(res.headers);
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
    const policy = new CachePolicy(cacheReq, cacheRes, { shared: true });

    // Check if the request & response is cacheable, if not return undefined
    if (
      req.method !== "GET" ||
      "set-cookie" in resHeaders ||
      !policy.storable()
    ) {
      return;
    }

    // If it is cacheable, store it in KV
    const key = Cache._getKey(req);
    await this.namespace.put(
      key,
      JSON.stringify({
        status: res.status,
        headers: res.headers.raw(),
        body: Buffer.from(await res.arrayBuffer()).toString("base64"),
      } as CachedResponse),
      {
        expirationTtl: policy.timeToLive() / 1000,
      }
    );
  }

  async match(
    req: string | Request,
    options?: CacheMatchOptions
  ): Promise<Response | undefined> {
    req = Cache._normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" || options?.ignoreMethod) return;

    // Check if we have the response cached
    const key = Cache._getKey(req);
    const res = await this.namespace.get<CachedResponse>(key, "json");
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
    req = Cache._normaliseRequest(req);
    // Cloudflare only caches GET requests
    if (req.method !== "GET" || options?.ignoreMethod) return false;

    // Delete the cached response if it exists (we delete from this.storage not
    // this.namespace since we need to know whether we deleted something)
    const key = Cache._getKey(req);
    return this.storage.delete(key);
  }
}

export class CacheModule extends Module {
  private readonly storageFactory: KVStorageFactory;

  constructor(log: Log, persistRoot = defaultPersistRoot) {
    super(log);
    this.storageFactory = new KVStorageFactory(persistRoot);
  }

  getCache(name = "default", persist?: boolean | string): Cache {
    return new Cache(this.storageFactory.getStorage(name, persist));
  }

  buildSandbox(options: ProcessedOptions): Context {
    const defaultCache = this.getCache(undefined, options.cachePersist);
    return { caches: { default: defaultCache } };
  }
}
