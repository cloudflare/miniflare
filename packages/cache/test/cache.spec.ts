import assert from "assert";
import { URL } from "url";
import { Cache, CachedMeta } from "@miniflare/cache";
import { Request, RequestInitCfProperties, Response } from "@miniflare/core";
import { Storage } from "@miniflare/shared";
import {
  getObjectProperties,
  utf8Decode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import { WebSocketPair } from "@miniflare/web-sockets";
import anyTest, { Macro, TestInterface } from "ava";
import {
  Request as BaseRequest,
  Response as BaseResponse,
  HeadersInit,
  RequestInfo,
} from "undici";
import { testResponse } from "./helpers";

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
  const cache = new Cache(storage, clockFunction);
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
test("Cache: put respects cf cacheTtl", async (t) => {
  const { clock, cache } = t.context;
  await cache.put(
    new Request("http://localhost/test", { cf: { cacheTtl: 1 } }),
    new BaseResponse("value")
  );
  t.not(await cache.match("http://localhost/test"), undefined);
  clock.timestamp += 500;
  t.not(await cache.match("http://localhost/test"), undefined);
  clock.timestamp += 500;
  t.is(await cache.match("http://localhost/test"), undefined);
});
test("Cache: put respects cf cacheTtlByStatus", async (t) => {
  const { clock, cache } = t.context;
  const cf: RequestInitCfProperties = {
    cacheTtlByStatus: { "200-299": 2, "? :D": 99, "404": 1, "500-599": 0 },
  };
  const headers = { "Cache-Control": "max-age=5" };
  const req200 = new Request("http://localhost/200", { cf });
  const req201 = new Request("http://localhost/201", { cf });
  const req302 = new Request("http://localhost/302", { cf });
  const req404 = new Request("http://localhost/404", { cf });
  const req599 = new Request("http://localhost/599", { cf });
  await cache.put(req200, new BaseResponse(null, { status: 200, headers }));
  await cache.put(req201, new BaseResponse(null, { status: 201, headers }));
  await cache.put(req302, new BaseResponse(null, { status: 302, headers }));
  await cache.put(req404, new BaseResponse(null, { status: 404, headers }));
  await cache.put(req599, new BaseResponse(null, { status: 599, headers }));

  // Check all but 5xx responses cached
  t.not(await cache.match("http://localhost/200"), undefined);
  t.not(await cache.match("http://localhost/201"), undefined);
  t.not(await cache.match("http://localhost/302"), undefined);
  t.not(await cache.match("http://localhost/404"), undefined);
  t.is(await cache.match("http://localhost/599"), undefined);

  // Check 404 response expires after 1 second
  clock.timestamp += 1000;
  t.not(await cache.match("http://localhost/200"), undefined);
  t.not(await cache.match("http://localhost/201"), undefined);
  t.not(await cache.match("http://localhost/302"), undefined);
  t.is(await cache.match("http://localhost/404"), undefined);

  // Check 2xx responses expire after 2 seconds
  clock.timestamp += 1000;
  t.is(await cache.match("http://localhost/200"), undefined);
  t.is(await cache.match("http://localhost/201"), undefined);
  t.not(await cache.match("http://localhost/302"), undefined);

  // Check 302 response expires after 5 seconds
  clock.timestamp += 3000;
  t.is(await cache.match("http://localhost/302"), undefined);
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

test("Cache: match MISS waits for input gate to open before returning", async (t) => {
  const { cache } = t.context;
  await waitsForInputGate(t, () => cache.match("http://localhost:8787/"));
});
test("Cache: match HIT waits for input gate to open before returning", async (t) => {
  const { cache } = t.context;
  await cache.put("http://localhost:8787/", testResponse());
  await waitsForInputGate(t, () => cache.match("http://localhost:8787/"));
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
