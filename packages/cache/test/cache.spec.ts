import assert from "assert";
import { URL } from "url";
import { Cache, CachedMeta } from "@miniflare/cache";
import { StorageOperator } from "@miniflare/shared";
import { MemoryStorageOperator } from "@miniflare/storage-memory";
import anyTest, { Macro, TestInterface } from "ava";
import { getObjectProperties, utf8Decode } from "test:@miniflare/shared";
import { HeadersInit, Request, RequestInfo, Response } from "undici";
import { testResponse } from "./helpers";

interface Context {
  storage: StorageOperator;
  clock: { timestamp: number };
  cache: Cache;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const clock = { timestamp: 1_000_000 }; // 1000s
  const clockFunction = () => clock.timestamp;
  const storage = new MemoryStorageOperator(undefined, clockFunction);
  const cache = new Cache(storage, clockFunction);
  t.context = { storage, clock, cache };
});

// Cache:* tests adapted from Cloudworker:
// https://github.com/dollarshaveclub/cloudworker/blob/master/lib/runtime/cache/__tests__/cache.test.js
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
test("request", putMacro, new Request("http://localhost:8787/test"));
test("string request", putMacro, "http://localhost:8787/test");
test("url request", putMacro, new URL("http://localhost:8787/test"));

test("Cache: only puts GET requests", async (t) => {
  const { storage, cache } = t.context;
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    await cache.put(
      new Request(`http://localhost:8787/${method}`, { method }),
      testResponse()
    );
  }
  t.deepEqual(
    (await storage.list()).keys.map(({ name }) => name),
    ["http://localhost:8787/GET"]
  );
});

const matchMacro: Macro<[RequestInfo], Context> = async (t, req) => {
  const { cache } = t.context;
  await cache.put(new Request("http://localhost:8787/test"), testResponse());

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
test("request", matchMacro, new Request("http://localhost:8787/test"));
test("string request", matchMacro, "http://localhost:8787/test");
test("url request", matchMacro, new URL("http://localhost:8787/test"));

test("Cache: only matches non-GET requests when ignoring method", async (t) => {
  const { cache } = t.context;
  await cache.put(new Request("http://localhost:8787/test"), testResponse());
  const req = new Request("http://localhost:8787/test", { method: "POST" });
  t.is(await cache.match(req), undefined);
  t.not(await cache.match(req, { ignoreMethod: true }), undefined);
});

const deleteMacro: Macro<[RequestInfo], Context> = async (t, req) => {
  const { storage, cache } = t.context;
  await cache.put(new Request("http://localhost:8787/test"), testResponse());
  t.not(await storage.get("http://localhost:8787/test"), undefined);
  t.true(await cache.delete(req));
  t.is(await storage.get("http://localhost:8787/test"), undefined);
  t.false(await cache.delete(req));
};
deleteMacro.title = (providedTitle) => `Cache: deletes ${providedTitle}`;
test("request", deleteMacro, new Request("http://localhost:8787/test"));
test("string request", deleteMacro, "http://localhost:8787/test");
test("url request", deleteMacro, new URL("http://localhost:8787/test"));

test("Cache: only deletes non-GET requests when ignoring method", async (t) => {
  const { cache } = t.context;
  await cache.put(new Request("http://localhost:8787/test"), testResponse());
  const req = new Request("http://localhost:8787/test", { method: "POST" });
  t.false(await cache.delete(req));
  t.true(await cache.delete(req, { ignoreMethod: true }));
});

const expireMacro: Macro<
  [{ headers: HeadersInit; expectedTtl: number }],
  Context
> = async (t, { headers, expectedTtl }) => {
  const { clock, cache } = t.context;
  await cache.put(
    new Request("http://localhost:8787/test"),
    new Response("value", { headers })
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
    new Request("http://localhost:8787/test"),
    new Response("value", {
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
