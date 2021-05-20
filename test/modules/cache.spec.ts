import { existsSync, promises as fs } from "fs";
import path from "path";
import { HeadersInit } from "@mrbbot/node-fetch";
import anyTest, { Macro, TestInterface } from "ava";
import {
  Cache,
  KVStorage,
  MemoryKVStorage,
  NoOpLog,
  Request,
  Response,
} from "../../src";
import { CacheModule, CachedResponse } from "../../src/modules/cache";
import { runInWorker, useTmp, wait } from "../helpers";

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

test("getCache: creates persistent cache at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const cache = module.getCache("test", true);
  await cache.put("http://localhost:8787/", testResponse.clone());
  t.true(existsSync(path.join(tmp, "test", "http___localhost_8787_.json")));
  t.is(await (await cache.match("http://localhost:8787/"))?.text(), "value");
});
test("getCache: creates persistent cache at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmpDefault);
  const cache = module.getCache("test", tmpCustom);
  await cache.put("http://localhost:8787/", testResponse.clone());
  t.false(
    existsSync(path.join(tmpDefault, "test", "http___localhost_8787_.json"))
  );
  t.true(
    existsSync(path.join(tmpCustom, "test", "http___localhost_8787_.json"))
  );
  t.is(await (await cache.match("http://localhost:8787/"))?.text(), "value");
});
test("getCache: creates in-memory cache", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const cache = module.getCache("test");
  await cache.put("http://localhost:8787/", testResponse.clone());
  t.false(existsSync(path.join(tmp, "test", "http___localhost_8787_.json")));
  t.is(await (await cache.match("http://localhost:8787/"))?.text(), "value");
});
test("getCache: reuses existing storage for in-memory cache", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const cache1 = module.getCache("test", false);
  await cache1.put(
    "http://localhost:8787/1",
    new Response("value1", { headers: { "Cache-Control": "max-age=3600" } })
  );
  const cache2 = module.getCache("test", false);
  await cache2.put(
    "http://localhost:8787/2",
    new Response("value2", { headers: { "Cache-Control": "max-age=3600" } })
  );
  t.false(existsSync(path.join(tmp, "test", "http___localhost_8787_1.json")));
  t.false(existsSync(path.join(tmp, "test", "http___localhost_8787_2.json")));
  t.is(await (await cache1.match("http://localhost:8787/1"))?.text(), "value1");
  t.is(await (await cache1.match("http://localhost:8787/2"))?.text(), "value2");
  t.is(await (await cache2.match("http://localhost:8787/1"))?.text(), "value1");
  t.is(await (await cache2.match("http://localhost:8787/2"))?.text(), "value2");
});

test("buildSandbox: creates persistent default cache at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const { caches } = module.buildSandbox({ cachePersist: true });
  t.true("default" in caches);
  await caches.default.put("http://localhost:8787/", testResponse.clone());
  t.true(existsSync(path.join(tmp, "default", "http___localhost_8787_.json")));
  t.is(
    await (await caches.default.match("http://localhost:8787/"))?.text(),
    "value"
  );
});
test("buildSandbox: creates persistent default cache at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmpDefault);
  const { caches } = module.buildSandbox({ cachePersist: tmpCustom });
  t.true("default" in caches);
  await caches.default.put("http://localhost:8787/", testResponse.clone());
  t.false(
    existsSync(path.join(tmpDefault, "default", "http___localhost_8787_.json"))
  );
  t.true(
    existsSync(path.join(tmpCustom, "default", "http___localhost_8787_.json"))
  );
  t.is(
    await (await caches.default.match("http://localhost:8787/"))?.text(),
    "value"
  );
});
test("buildSandbox: creates in-memory default cache", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const { caches } = module.buildSandbox({ cachePersist: false });
  t.true("default" in caches);
  await caches.default.put("http://localhost:8787/", testResponse.clone());
  t.false(existsSync(path.join(tmp, "default", "http___localhost_8787_.json")));
  t.is(
    await (await caches.default.match("http://localhost:8787/"))?.text(),
    "value"
  );
});
test("buildSandbox: reuses existing storage for default cache", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), tmp);
  const { caches: caches1 } = module.buildSandbox({});
  t.true("default" in caches1);
  await caches1.default.put(
    "http://localhost:8787/1",
    new Response("value1", { headers: { "Cache-Control": "max-age=3600" } })
  );
  const { caches: caches2 } = module.buildSandbox({});
  t.true("default" in caches2);
  await caches2.default.put(
    "http://localhost:8787/2",
    new Response("value2", { headers: { "Cache-Control": "max-age=3600" } })
  );
  t.false(
    existsSync(path.join(tmp, "default", "http___localhost_8787_1.json"))
  );
  t.false(
    existsSync(path.join(tmp, "default", "http___localhost_8787_2.json"))
  );
  t.is(
    await (await caches1.default.match("http://localhost:8787/1"))?.text(),
    "value1"
  );
  t.is(
    await (await caches1.default.match("http://localhost:8787/2"))?.text(),
    "value2"
  );
  t.is(
    await (await caches2.default.match("http://localhost:8787/1"))?.text(),
    "value1"
  );
  t.is(
    await (await caches2.default.match("http://localhost:8787/2"))?.text(),
    "value2"
  );
});

test("buildSandbox: can put with default cache", async (t) => {
  const tmp = await useTmp(t);
  await runInWorker({ cachePersist: tmp }, () => {
    const sandbox = self as any;
    const cache = sandbox.caches.default as Cache;
    return cache.put(
      "http://localhost:8787/test",
      new sandbox.Response("value", {
        headers: { "Cache-Control": "max-age=3600" },
      })
    );
  });
  const cached: CachedResponse = JSON.parse(
    await fs.readFile(
      path.join(tmp, "default", "http___localhost_8787_test.json"),
      "utf8"
    )
  );
  t.deepEqual(cached, {
    status: 200,
    headers: { "Cache-Control": ["max-age=3600"] },
    body: Buffer.from("value", "utf8").toString("base64"),
  });
});
test("buildSandbox: can match with default cache", async (t) => {
  const tmp = await useTmp(t);
  const cached = await runInWorker({ cachePersist: tmp }, async () => {
    const sandbox = self as any;
    const cache = sandbox.caches.default as Cache;
    await cache.put(
      "http://localhost:8787/test",
      new sandbox.Response("value", {
        headers: { "Cache-Control": "max-age=3600" },
      })
    );
    const cached = await cache.match("http://localhost:8787/test");
    return {
      status: cached?.status,
      headers: cached?.headers.raw(),
      body: await cached?.text(),
    };
  });
  t.deepEqual(cached, {
    status: 200,
    headers: { "Cache-Control": ["max-age=3600"] },
    body: "value",
  });
});
test("buildSandbox: can delete from default cache", async (t) => {
  const tmp = await useTmp(t);
  const deleted = await runInWorker({ cachePersist: tmp }, async () => {
    const sandbox = self as any;
    const cache = sandbox.caches.default as Cache;
    await cache.put(
      "http://localhost:8787/test",
      new sandbox.Response("value", {
        headers: { "Cache-Control": "max-age=3600" },
      })
    );
    return cache.delete("http://localhost:8787/test");
  });
  t.true(deleted);
  t.false(
    existsSync(path.join(tmp, "default", "http___localhost_8787_test.json"))
  );
});
