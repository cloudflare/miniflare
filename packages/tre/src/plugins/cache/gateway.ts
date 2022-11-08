import crypto from "crypto";
import { AddressInfo } from "net";
import http from "node:http";
import CachePolicy from "http-cache-semantics";
import { Headers, Request, Response, fetch } from "undici";
import { Storage } from "../../storage";
import { CacheMiss, PurgeFailure, StorageFailure } from "./errors";
import { _getRangeResponse } from "./range";

interface CacheMetadata {
  value: Uint8Array;
  metadata: {
    headers: string[][];
    status: number;
  };
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

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag#syntax
const etagRegexp = /^(W\/)?"(.+)"$/;
function parseETag(value: string): string | undefined {
  // As we only use this for `If-None-Match` handling, which always uses the
  // weak comparison algorithm, ignore "W/" directives:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
  return etagRegexp.exec(value.trim())?.[2] ?? undefined;
}

// https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.1.1
const utcDateRegexp =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d\d\d\d \d\d:\d\d:\d\d GMT$/;
function parseUTCDate(value: string): number {
  return utcDateRegexp.test(value) ? Date.parse(value) : NaN;
}

// Lifted from Miniflare 2
function getMatchResponse(
  reqHeaders: Headers,
  resStatus: number,
  resHeaders: Headers,
  resBody: Uint8Array
): Response {
  // If `If-None-Match` is set, perform a conditional request:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
  const reqIfNoneMatchHeader = reqHeaders.get("If-None-Match");
  const resETagHeader = resHeaders.get("ETag");
  if (reqIfNoneMatchHeader !== null && resETagHeader !== null) {
    const resETag = parseETag(resETagHeader);
    if (resETag !== undefined) {
      if (reqIfNoneMatchHeader.trim() === "*") {
        return new Response(null, { status: 304, headers: resHeaders });
      }
      for (const reqIfNoneMatch of reqIfNoneMatchHeader.split(",")) {
        if (resETag === parseETag(reqIfNoneMatch)) {
          return new Response(null, { status: 304, headers: resHeaders });
        }
      }
    }
  }

  // If `If-Modified-Since` is set, perform a conditional request:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Modified-Since
  const reqIfModifiedSinceHeader = reqHeaders.get("If-Modified-Since");
  const resLastModifiedHeader = resHeaders.get("Last-Modified");
  if (reqIfModifiedSinceHeader !== null && resLastModifiedHeader !== null) {
    const reqIfModifiedSince = parseUTCDate(reqIfModifiedSinceHeader);
    const resLastModified = parseUTCDate(resLastModifiedHeader);
    // Comparison of NaN's (invalid dates), will always result in `false`
    if (resLastModified <= reqIfModifiedSince) {
      return new Response(null, { status: 304, headers: resHeaders });
    }
  }

  // If `Range` is set, return a partial response:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range
  const reqRangeHeader = reqHeaders.get("Range");
  if (reqRangeHeader !== null) {
    return _getRangeResponse(reqRangeHeader, resStatus, resHeaders, resBody);
  }

  // Otherwise, return the full response
  return new Response(resBody, { status: resStatus, headers: resHeaders });
}

class CacheResponse implements CacheMetadata {
  metadata: CacheMetadata["metadata"];
  value: Uint8Array;
  constructor(metadata: CacheMetadata["metadata"], value: Uint8Array) {
    this.metadata = metadata;
    this.value = value;
  }
  toResponse(): Response {
    return new Response(this.value, {
      status: this.metadata.status,
      headers: this.metadata.headers,
    });
  }
}

interface ParsedHttpResponse {
  headers: Headers;
  status: number;
  body: Uint8Array;
}
class HttpParser {
  server: http.Server;
  responses: Record<string, Uint8Array> = {};
  parsing: Promise<ParsedHttpResponse> =
    Promise.resolve() as unknown as Promise<ParsedHttpResponse>;
  connected: Promise<void>;
  constructor() {
    this.server = http.createServer(this.listen.bind(this));
    this.connected = new Promise((accept) => {
      this.server.listen(0, "localhost", () => {
        accept();
      });
    });
  }
  private listen(request: http.IncomingMessage, response: http.ServerResponse) {
    if (request.url) {
      response?.socket?.write(this.responses[request.url] ?? new Uint8Array());
    }
    response.end();
  }
  public async parse(response: Uint8Array): Promise<ParsedHttpResponse> {
    await this.connected;
    // Since multiple parses can be in-flight at once, an identifier is needed
    const id = `/${crypto.randomBytes(16).toString("hex")}`;
    this.responses[id] = response;
    const address = this.server.address()! as AddressInfo;
    const parsedResponse = await fetch(`http://localhost:${address.port}${id}`);
    const body = await parsedResponse.arrayBuffer();
    delete this.responses[id];
    return {
      headers: parsedResponse.headers,
      status: parsedResponse.status,
      body: new Uint8Array(body),
    };
  }
}

export class CacheGateway {
  parser: HttpParser;
  constructor(private readonly storage: Storage) {
    this.parser = new HttpParser();
  }

  async match(request: Request): Promise<Response> {
    const cached = await this.storage.get<CacheMetadata["metadata"]>(
      request.url
    );
    if (!cached || !cached?.metadata) throw new CacheMiss();

    const response = new CacheResponse(
      cached.metadata,
      cached.value
    ).toResponse();
    response.headers.set("CF-Cache-Status", "HIT");

    const res = getMatchResponse(
      request.headers,
      cached.metadata.status,
      response.headers,
      cached.value
    );
    return res;
  }

  async put(request: Request, value: ArrayBuffer): Promise<Response> {
    const response = await this.parser.parse(new Uint8Array(value));
    const responseHeaders = Object.fromEntries([...response.headers.entries()]);
    if (
      responseHeaders["cache-control"]
        ?.toLowerCase()
        .includes("private=set-cookie")
    ) {
      responseHeaders["cache-control"] = responseHeaders[
        "cache-control"
      ].replace(/private=set-cookie/i, "");
      delete responseHeaders["set-cookie"];
    }
    const policy = new CachePolicy(
      { url: request.url, headers: normaliseHeaders(request.headers) },
      { ...response, headers: responseHeaders },
      { shared: true }
    );

    const headers = Object.entries(policy.responseHeaders()) as [
      string,
      string
    ][];

    if (!policy.storable() || !!headers.find(([h]) => h == "set-cookie")) {
      throw new StorageFailure();
    }

    await this.storage.put<CacheMetadata["metadata"]>(request.url, {
      value: response.body,
      metadata: {
        headers: headers,
        status: response.status,
      },
    });
    return new Response(null, { status: 204 });
  }

  async delete(request: Request): Promise<Response> {
    const deleted = await this.storage.delete(request.url);
    // This is an extremely vague error, but it fits with what the cache API in workerd expects
    if (!deleted) throw new PurgeFailure();
    return new Response(null);
  }
}
