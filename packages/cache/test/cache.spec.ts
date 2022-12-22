import assert from "assert";
import { URL } from "url";
import { Cache, CacheError, CachedMeta } from "@miniflare/cache";
import { Request, Response } from "@miniflare/core";
import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  RequestContextOptions,
  Storage,
} from "@miniflare/shared";
import {
  advancesTime,
  getObjectProperties,
  utf8Decode,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import { WebSocketPair } from "@miniflare/web-sockets";
import anyTest, { Macro, TestInterface, ThrowsExpectation } from "ava";
import {
  Request as BaseRequest,
  Response as BaseResponse,
  HeadersInit,
  RequestInfo,
} from "undici";
import { testResponse } from "./helpers";

const requestCtxOptions: RequestContextOptions = {
  externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
};

interface Context {
  storage: Storage;
  clock: { timestamp: number };
  cache: Cache;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const clock = { timestamp: 1_000_000 }; // 1000s
  const clockFunction = () => clock.timestamp;
  const storage = new MemoryStorage(undefined, clockFunction);
  const cache = new Cache(storage, { clock: clockFunction });
  t.context = { storage, clock, cache };
});

// Cache:* tests adapted from Cloudworker:
// https://github.com/dollarshaveclub/cloudworker/blob/4976f88c3d2629fbbd4ca49da88b9c8bf048ce0f/lib/runtime/cache/__tests__/cache.test.js
const putMacro: Macro<[RequestInfo], Context> = async (t, req) => {
  const { storage, cache } = t.context;
  await cache.put(req, testResponse());

  const stored = await storage.get<CachedMeta>("http://localhost:8787/test");
  t.not(stored, undefined);
  t.not(stored?.expiration, undefined);
  assert(stored?.expiration); // for TypeScript
  t.is(stored.expiration, 1000 + 3600);

  t.not(stored.metadata, undefined);
  assert(stored.metadata); // for TypeScript
  t.is(stored.metadata.status, 200);
  t.deepEqual(stored.metadata.headers, [
    ["cache-control", "max-age=3600"],
    ["content-type", "text/plain; charset=utf8"],
  ]);

  t.is(utf8Decode(stored.value), "value");
};
putMacro.title = (providedTitle) => `Cache: puts ${providedTitle}`;
test("request", putMacro, new BaseRequest("http://localhost:8787/test"));
test("string request", putMacro, "http://localhost:8787/test");
test("url request", putMacro, new URL("http://localhost:8787/test"));

test("Cache: doesn't cache WebSocket responses", async (t) => {
  const { cache } = t.context;
  const pair = new WebSocketPair();
  const res = new Response(null, {
    status: 101,
    webSocket: pair["0"],
  });
  await t.throwsAsync(cache.put("http://localhost:8787/", res), {
    instanceOf: TypeError,
    message: "Cannot cache WebSocket upgrade response.",
  });
});
test("Cache: only puts GET requests", async (t) => {
  const { cache } = t.context;
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await t.throwsAsync(
      cache.put(
        new BaseRequest(`http://localhost:8787/${method}`, { method }),
        testResponse()
      ),
      {
        instanceOf: TypeError,
        message: "Cannot cache response to non-GET request.",
      }
    );
  }
});
test("Cache: doesn't cache partial content responses", async (t) => {
  const { cache } = t.context;
  const res = new Response("body", {
    status: 206,
    headers: { "content-range": "bytes 0-4/8" },
  });
  await t.throwsAsync(cache.put("http://localhost:8787/", res), {
    instanceOf: TypeError,
    message: "Cannot cache response to a range request (206 Partial Content).",
  });
});
test("Cache: doesn't cache vary all responses", async (t) => {
  const { cache } = t.context;
  let res = new Response("body", {
    headers: { vary: "*" },
  });
  await t.throwsAsync(cache.put("http://localhost:8787/", res), {
    instanceOf: TypeError,
    message: "Cannot cache response with 'Vary: *' header.",
  });
  res = new Response("body", {
    headers: { vary: "user-agent, *" },
  });
  await t.throwsAsync(cache.put("http://localhost:8787/", res), {
    instanceOf: TypeError,
    message: "Cannot cache response with 'Vary: *' header.",
  });
});
test("Cache: respects cache key", async (t) => {
  const { storage, cache } = t.context;

  const req1 = new Request("http://localhost/", { cf: { cacheKey: "1" } });
  const req2 = new Request("http://localhost/", { cf: { cacheKey: "2" } });
  const res1 = testResponse("value1");
  const res2 = testResponse("value2");

  await cache.put(req1, res1);
  await cache.put(req2, res2);
  t.true(await storage.has("1"));
  t.true(await storage.has("2"));

  const match1 = await cache.match(req1);
  const match2 = await cache.match(req2);
  t.is(await match1?.text(), "value1");
  t.is(await match2?.text(), "value2");
});

test("Cache: put increments subrequest count", async (t) => {
  const { cache } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => cache.put("http://localhost:8787/", testResponse()));
  t.is(ctx.externalSubrequests, 1);
});
test("Cache: put waits for output gate to open before storing", (t) => {
  const { cache } = t.context;
  return waitsForOutputGate(
    t,
    () => cache.put("http://localhost:8787/", testResponse()),
    () => cache.match("http://localhost:8787/")
  );
});
test("Cache: put waits for input gate to open before returning", (t) => {
  const { cache } = t.context;
  return waitsForInputGate(t, () =>
    cache.put("http://localhost:8787/", testResponse())
  );
});

const matchMacro: Macro<[RequestInfo], Context> = async (t, req) => {
  const { cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    testResponse()
  );

  const cached = await cache.match(req);
  t.not(cached, undefined);
  assert(cached); // for TypeScript
  t.is(cached.status, 200);
  t.deepEqual(
    [...cached.headers],
    [
      ["cache-control", "max-age=3600"],
      ["cf-cache-status", "HIT"],
      ["content-type", "text/plain; charset=utf8"],
    ]
  );
  t.is(await cached?.text(), "value");
};
matchMacro.title = (providedTitle) => `Cache: matches ${providedTitle}`;
test("request", matchMacro, new BaseRequest("http://localhost:8787/test"));
test("string request", matchMacro, "http://localhost:8787/test");
test("url request", matchMacro, new URL("http://localhost:8787/test"));

test("Cache: only matches non-GET requests when ignoring method", async (t) => {
  const { cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    testResponse()
  );
  const req = new BaseRequest("http://localhost:8787/test", { method: "POST" });
  t.is(await cache.match(req), undefined);
  t.not(await cache.match(req, { ignoreMethod: true }), undefined);
});

test("Cache: match increments subrequest count", async (t) => {
  const { cache } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => cache.match("http://localhost:8787/"));
  t.is(ctx.externalSubrequests, 1);
});
test("Cache: match MISS waits for input gate to open before returning", async (t) => {
  const { cache } = t.context;
  await waitsForInputGate(t, () => cache.match("http://localhost:8787/"));
});
test("Cache: match HIT waits for input gate to open before returning", async (t) => {
  const { cache } = t.context;
  await cache.put("http://localhost:8787/", testResponse());
  await waitsForInputGate(t, () => cache.match("http://localhost:8787/"));
});
test("Cache: match throws if attempting to load cached response created with Miniflare 1", async (t) => {
  const { storage, cache } = t.context;
  const value = JSON.stringify({
    status: 200,
    headers: { "Cache-Control": ["max-age=3600"] },
    body: "Ym9keQ==", // body in base64
  });
  await storage.put("http://localhost:8787/test", { value: utf8Encode(value) });
  await t.throwsAsync(cache.match("http://localhost:8787/test"), {
    instanceOf: CacheError,
    code: "ERR_DESERIALIZATION",
    message:
      "Unable to deserialize stored cached data due to missing metadata.\n" +
      "The cached data storage format changed in Miniflare 2. You cannot " +
      "load cached data created with Miniflare 1 and must delete it.",
  });
});
test("Cache: match respects If-None-Match header", async (t) => {
  const { cache } = t.context;
  const res = new Response("value", {
    headers: {
      ETag: '"thing"',
      "Cache-Control": "max-age=3600",
    },
  });
  await cache.put("http://localhost:8787/test", res);

  const ifNoneMatch = (value: string) =>
    new BaseRequest("http://localhost:8787/test", {
      headers: { "If-None-Match": value },
    });

  // Check returns 304 only if an ETag in `If-Modified-Since` matches
  let cacheRes = await cache.match(ifNoneMatch('"thing"'));
  t.is(cacheRes?.status, 304);
  cacheRes = await cache.match(ifNoneMatch('   W/"thing"      '));
  t.is(cacheRes?.status, 304);
  cacheRes = await cache.match(ifNoneMatch('"not the thing"'));
  t.is(cacheRes?.status, 200);
  cacheRes = await cache.match(
    ifNoneMatch('"not the thing",    "thing"    , W/"still not the thing"')
  );
  t.is(cacheRes?.status, 304);
  cacheRes = await cache.match(ifNoneMatch("*"));
  t.is(cacheRes?.status, 304);
  cacheRes = await cache.match(ifNoneMatch("    *   "));
  t.is(cacheRes?.status, 304);
});
test("Cache: match respects If-Modified-Since header", async (t) => {
  const { cache } = t.context;
  const res = new Response("value", {
    headers: {
      "Last-Modified": "Tue, 13 Sep 2022 12:00:00 GMT",
      "Cache-Control": "max-age=3600",
    },
  });
  await cache.put("http://localhost:8787/test", res);

  const ifModifiedSince = (value: string) =>
    new BaseRequest("http://localhost:8787/test", {
      headers: { "If-Modified-Since": value },
    });

  // Check returns 200 if modified after `If-Modified-Since`
  let cacheRes = await cache.match(
    ifModifiedSince("Tue, 13 Sep 2022 11:00:00 GMT")
  );
  t.is(cacheRes?.status, 200);
  // Check returns 304 if modified on `If-Modified-Since`
  cacheRes = await cache.match(
    ifModifiedSince("Tue, 13 Sep 2022 12:00:00 GMT")
  );
  t.is(cacheRes?.status, 304);
  // Check returns 304 if modified before `If-Modified-Since`
  cacheRes = await cache.match(
    ifModifiedSince("Tue, 13 Sep 2022 13:00:00 GMT")
  );
  t.is(cacheRes?.status, 304);
  // Check returns 200 if `If-Modified-Since` is not a "valid" UTC date
  cacheRes = await cache.match(ifModifiedSince("13 Sep 2022 13:00:00 GMT"));
  t.is(cacheRes?.status, 200);
});
test("Cache: match respects Range header", async (t) => {
  const { cache } = t.context;
  const testRes = new Response("0123456789", {
    headers: {
      "Content-Length": "10",
      "Cache-Control": "max-age=3600",
    },
  });
  await cache.put("http://localhost:8787/test", testRes);
  const req = new BaseRequest("http://localhost:8787/test", {
    headers: { Range: "bytes=2-4" },
  });
  const res = await cache.match(req);
  t.is(res?.status, 206);
  t.is(res?.headers.get("Content-Length"), "3");
  t.is(await res?.text(), "234");
});
test("Cache: match returns Response with immutable headers", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/365
  const { cache } = t.context;
  await cache.put("http://localhost:8787/", testResponse());
  const cached = await cache.match("http://localhost:8787/");
  t.throws(() => cached?.headers.set("X-Key", "value"), {
    instanceOf: TypeError,
    message: "immutable",
  });
});

const deleteMacro: Macro<[RequestInfo], Context> = async (t, req) => {
  const { storage, cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    testResponse()
  );
  t.not(await storage.get("http://localhost:8787/test"), undefined);
  t.true(await cache.delete(req));
  t.is(await storage.get("http://localhost:8787/test"), undefined);
  t.false(await cache.delete(req));
};
deleteMacro.title = (providedTitle) => `Cache: deletes ${providedTitle}`;
test("request", deleteMacro, new BaseRequest("http://localhost:8787/test"));
test("string request", deleteMacro, "http://localhost:8787/test");
test("url request", deleteMacro, new URL("http://localhost:8787/test"));

test("Cache: only deletes non-GET requests when ignoring method", async (t) => {
  const { cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    testResponse()
  );
  const req = new BaseRequest("http://localhost:8787/test", { method: "POST" });
  t.false(await cache.delete(req));
  t.true(await cache.delete(req, { ignoreMethod: true }));
});

test("Cache: delete increments subrequest count", async (t) => {
  const { cache } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => cache.delete("http://localhost:8787/"));
  t.is(ctx.externalSubrequests, 1);
});
test("Cache: delete waits for output gate to open before deleting", async (t) => {
  const { cache } = t.context;
  await cache.put("http://localhost:8787/", testResponse());
  await waitsForOutputGate(
    t,
    () => cache.delete("http://localhost:8787/"),
    async () => !(await cache.match("http://localhost:8787/"))
  );
});
test("Cache: delete waits for input gate to open before returning", async (t) => {
  const { cache } = t.context;
  await cache.put("http://localhost:8787/", testResponse());
  await waitsForInputGate(t, () => cache.delete("http://localhost:8787/"));
});

const expireMacro: Macro<
  [{ headers: HeadersInit; expectedTtl: number }],
  Context
> = async (t, { headers, expectedTtl }) => {
  const { clock, cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    new BaseResponse("value", { headers })
  );
  t.not(await cache.match("http://localhost:8787/test"), undefined);
  clock.timestamp += expectedTtl / 2;
  t.not(await cache.match("http://localhost:8787/test"), undefined);
  clock.timestamp += expectedTtl / 2;
  t.is(await cache.match("http://localhost:8787/test"), undefined);
};
expireMacro.title = (providedTitle) => `Cache: expires after ${providedTitle}`;
test("Expires", expireMacro, {
  headers: { Expires: new Date(1000000 + 2000).toUTCString() },
  expectedTtl: 2000,
});
test("Cache-Control's max-age", expireMacro, {
  headers: { "Cache-Control": "max-age=1" },
  expectedTtl: 1000,
});
test("Cache-Control's s-maxage", expireMacro, {
  headers: { "Cache-Control": "s-maxage=1, max-age=10" },
  expectedTtl: 1000,
});

const isCachedMacro: Macro<
  [{ headers: { [key: string]: string }; cached: boolean }],
  Context
> = async (t, { headers, cached }) => {
  const { storage, cache } = t.context;
  await cache.put(
    new BaseRequest("http://localhost:8787/test"),
    new BaseResponse("value", {
      headers: {
        ...headers,
        Expires: new Date(Date.now() + 2000).toUTCString(),
      },
    })
  );
  const storedValue = await storage.get("http://localhost:8787/test");
  (cached ? t.not : t.is)(storedValue, undefined);
  const cachedRes = await cache.match("http://localhost:8787/test");
  (cached ? t.not : t.is)(cachedRes, undefined);
};
isCachedMacro.title = (providedTitle) => `Cache: ${providedTitle}`;
test("does not cache with private Cache-Control", isCachedMacro, {
  headers: { "Cache-Control": "private" },
  cached: false,
});
test("does not cache with no-store Cache-Control", isCachedMacro, {
  headers: { "Cache-Control": "no-store" },
  cached: false,
});
test("does not cache with no-cache Cache-Control", isCachedMacro, {
  headers: { "Cache-Control": "no-cache" },
  cached: false,
});
test("does not cache with Set-Cookie", isCachedMacro, {
  headers: { "Set-Cookie": "key=value" },
  cached: false,
});
test(
  "caches with Set-Cookie if Cache-Control private=set-cookie",
  isCachedMacro,
  {
    headers: {
      "Cache-Control": "private=set-cookie",
      "Set-Cookie": "key=value",
    },
    cached: true,
  }
);

test("Cache: hides implementation details", (t) => {
  const { cache } = t.context;
  t.deepEqual(getObjectProperties(cache), ["delete", "match", "put"]);
});
test("Cache: operations throw outside request handler", async (t) => {
  const cache = new Cache(new MemoryStorage(), { blockGlobalAsyncIO: true });
  const ctx = new RequestContext(requestCtxOptions);

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };
  await t.throwsAsync(
    cache.put("http://localhost:8787/", testResponse()),
    expectations
  );
  await t.throwsAsync(cache.match("http://localhost:8787/"), expectations);
  await t.throwsAsync(cache.delete("http://localhost:8787/"), expectations);

  await ctx.runWith(() => cache.put("http://localhost:8787/", testResponse()));
  await ctx.runWith(() => cache.match("http://localhost:8787/"));
  await ctx.runWith(() => cache.delete("http://localhost:8787/"));
});
test("Cache: operations advance current time", async (t) => {
  const { cache } = t.context;
  await advancesTime(t, () =>
    cache.put("http://localhost:8787/", testResponse())
  );
  await advancesTime(t, () => cache.match("http://localhost:8787/"));
  await advancesTime(t, () => cache.delete("http://localhost:8787/"));
});
