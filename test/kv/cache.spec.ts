import { HeadersInit } from "@mrbbot/node-fetch";
import anyTest, { Macro, TestInterface } from "ava";
import {
  Cache,
  CachedResponse,
  KVStorage,
  MemoryKVStorage,
  Request,
  Response,
} from "../../src";
import { wait } from "../helpers";

interface Context {
  storage: KVStorage;
  cache: Cache;
  start: number;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const storage = new MemoryKVStorage();
  const cache = new Cache(storage);
  const start = Date.now() / 1000;
  t.context = { storage, cache, start };
});

const testResponse = new Response("value", {
  headers: { "Cache-Control": "max-age=3600" },
});

// Cache:* tests adapted from Cloudworker:
// https://github.com/dollarshaveclub/cloudworker/blob/master/lib/runtime/cache/__tests__/cache.test.js
const putMacro: Macro<[string | Request], Context> = async (t, req) => {
  const { storage, cache, start } = t.context;
  await cache.put(req, testResponse.clone());

  const storedValue = await storage.get("http___localhost_8787_test.json");
  t.not(storedValue, undefined);
  t.not(storedValue?.expiration, undefined);
  if (!storedValue?.expiration) return; // for TypeScript
  t.true(Math.abs(storedValue.expiration - (start + 3600)) < 10);

  const cached: CachedResponse = JSON.parse(storedValue.value.toString("utf8"));
  t.deepEqual(cached, {
    status: 200,
    headers: { "Cache-Control": ["max-age=3600"] },
    body: Buffer.from("value", "utf8").toString("base64"),
  });
};
putMacro.title = (providedTitle) => `Cache: puts ${providedTitle}`;
test("request", putMacro, new Request("http://localhost:8787/test"));
test("string request", putMacro, "http://localhost:8787/test");

test("Cache: only puts GET requests", async (t) => {
  const { storage, cache } = t.context;
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    await cache.put(
      new Request(`http://localhost:8787/${method}`, { method }),
      testResponse.clone()
    );
  }
  t.deepEqual(
    (await storage.list()).map(({ name }) => name),
    ["http___localhost_8787_GET.json"]
  );
});

const matchMacro: Macro<[string | Request], Context> = async (t, req) => {
  const { cache } = t.context;
  await cache.put(
    new Request("http://localhost:8787/test"),
    testResponse.clone()
  );

  const cached = await cache.match(req);
  t.is(cached?.status, 200);
  t.deepEqual(cached?.headers.raw(), { "Cache-Control": ["max-age=3600"] });
  t.is(await cached?.text(), "value");
};
matchMacro.title = (providedTitle) => `Cache: matches ${providedTitle}`;
test("request", matchMacro, new Request("http://localhost:8787/test"));
test("string request", matchMacro, "http://localhost:8787/test");

const deleteMacro: Macro<[string | Request], Context> = async (t, req) => {
  const { storage, cache } = t.context;
  await cache.put(
    new Request("http://localhost:8787/test"),
    testResponse.clone()
  );
  t.not(await storage.get("http___localhost_8787_test.json"), undefined);
  t.true(await cache.delete(req));
  t.is(await storage.get("http___localhost_8787_test.json"), undefined);
  t.false(await cache.delete(req));
};
deleteMacro.title = (providedTitle) => `Cache: deletes ${providedTitle}`;
test("request", deleteMacro, new Request("http://localhost:8787/test"));
test("string request", deleteMacro, "http://localhost:8787/test");

const expireMacro: Macro<
  [{ headers: HeadersInit; expectedTtl: number }],
  Context
> = async (t, { headers, expectedTtl }) => {
  const { cache } = t.context;
  await cache.put(
    new Request("http://localhost:8787/test"),
    new Response("value", { headers })
  );
  t.not(await cache.match("http://localhost:8787/test"), undefined);
  await wait(expectedTtl);
  t.is(await cache.match("http://localhost:8787/test"), undefined);
};
expireMacro.title = (providedTitle) => `Cache: expires after ${providedTitle}`;
test("Expires", expireMacro, {
  headers: { Expires: new Date(Date.now() + 2000).toUTCString() },
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
  [{ headers: { [key: string]: string }; stored?: boolean; cached: boolean }],
  Context
> = async (t, { headers, stored, cached }) => {
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
  const storedValue = await storage.get("http___localhost_8787_test.json");
  (stored ?? cached ? t.not : t.is)(storedValue, undefined);
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
  stored: true,
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
