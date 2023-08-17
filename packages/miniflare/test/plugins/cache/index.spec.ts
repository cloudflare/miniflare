import assert from "assert";
import crypto from "crypto";
import path from "path";
import { text } from "stream/consumers";
import {
  CacheStorage,
  HeadersInit,
  KeyValueStorage,
  LogLevel,
  Request,
  RequestInit,
  Response,
  createFileStorage,
} from "miniflare";
import { MiniflareTestContext, miniflareTest, useTmp } from "../../test-shared";

interface Context extends MiniflareTestContext {
  caches: CacheStorage;
}

const test = miniflareTest<never, Context>({}, async (global, req) => {
  const { pathname } = new global.URL(req.url);
  // The API proxy doesn't support putting buffered bodies, so register a
  // special endpoint for testing
  if (pathname === "/put-buffered") {
    const resToCache = new global.Response("buffered", {
      headers: { "Cache-Control": "max-age=3600" },
    });
    await global.caches.default.put("http://localhost/cache-hit", resToCache);
    return new global.Response(null, { status: 204 });
  }
  return new global.Response(null, { status: 404 });
});

test.beforeEach(async (t) => {
  t.context.caches = await t.context.mf.getCaches();
});

test("match returns cached responses", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-hit";

  // Check caching stream body
  let resToCache = new Response("body", {
    headers: { "Cache-Control": "max-age=3600", "X-Key": "value" },
  });
  await cache.put(key, resToCache);
  let res = await cache.match(key);
  assert(res !== undefined);
  t.is(res.status, 200);
  t.is(res.headers.get("Cache-Control"), "max-age=3600");
  t.is(res.headers.get("CF-Cache-Status"), "HIT");
  t.is(res.headers.get("X-Key"), "value"); // Check custom headers stored
  t.is(await res.text(), "body");

  // Check caching binary streamed body
  const array = new Uint8Array([1, 2, 3]);
  resToCache = new Response(array, {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache);
  res = await cache.match(key);
  assert(res !== undefined);
  t.is(res.status, 200);
  t.deepEqual(new Uint8Array(await res.arrayBuffer()), array);

  // Check caching buffered body
  await t.context.mf.dispatchFetch("http://localhost/put-buffered", {
    method: "PUT",
  });
  res = await cache.match(key);
  assert(res !== undefined);
  t.is(res.status, 200);
  t.is(await res.text(), "buffered");
});
test("match returns nothing on cache miss", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-miss";
  const res = await cache.match(key);
  t.is(res, undefined);
});
test("match respects If-None-Match header", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-if-none-match";
  const resToCache = new Response("body", {
    headers: { ETag: '"thing"', "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache);

  const ifNoneMatch = (value: string) =>
    cache.match(new Request(key, { headers: { "If-None-Match": value } }));

  // Check returns 304 only if an ETag in `If-Modified-Since` matches
  let res = await ifNoneMatch('"thing"');
  t.is(res?.status, 304);
  res = await ifNoneMatch('   W/"thing"      ');
  t.is(res?.status, 304);
  res = await ifNoneMatch('"not the thing"');
  t.is(res?.status, 200);
  res = await ifNoneMatch(
    '"not the thing",    "thing"    , W/"still not the thing"'
  );
  t.is(res?.status, 304);
  res = await ifNoneMatch("*");
  t.is(res?.status, 304);
  res = await ifNoneMatch("    *   ");
  t.is(res?.status, 304);
});
test("match respects If-Modified-Since header", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-if-modified-since";
  const resToCache = new Response("body", {
    headers: {
      "Last-Modified": "Tue, 13 Sep 2022 12:00:00 GMT",
      "Cache-Control": "max-age=3600",
    },
  });
  await cache.put(key, resToCache);

  const ifModifiedSince = (value: string) =>
    cache.match(new Request(key, { headers: { "If-Modified-Since": value } }));

  // Check returns 200 if modified after `If-Modified-Since`
  let res = await ifModifiedSince("Tue, 13 Sep 2022 11:00:00 GMT");
  t.is(res?.status, 200);
  // Check returns 304 if modified on `If-Modified-Since`
  res = await ifModifiedSince("Tue, 13 Sep 2022 12:00:00 GMT");
  t.is(res?.status, 304);
  // Check returns 304 if modified before `If-Modified-Since`
  res = await ifModifiedSince("Tue, 13 Sep 2022 13:00:00 GMT");
  t.is(res?.status, 304);
  // Check returns 200 if `If-Modified-Since` is not a "valid" UTC date
  res = await ifModifiedSince("13 Sep 2022 13:00:00 GMT");
  t.is(res?.status, 200);
});
test("match respects Range header", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-range";
  const resToCache = new Response("0123456789", {
    headers: {
      "Content-Length": "10",
      "Content-Type": "text/plain",
      "Cache-Control": "max-age=3600",
    },
  });
  await cache.put(key, resToCache);

  // Check with single range
  let res = await cache.match(
    new Request(key, { headers: { Range: "bytes=2-4" } })
  );
  assert(res !== undefined);
  t.is(res.status, 206);
  t.is(res.headers.get("Content-Length"), "3");
  t.is(res.headers.get("Cache-Control"), "max-age=3600");
  t.is(res.headers.get("CF-Cache-Status"), "HIT");
  t.is(await res.text(), "234");

  // Check with multiple ranges
  res = await cache.match(
    new Request(key, { headers: { Range: "bytes=1-3,5-6" } })
  );
  assert(res !== undefined);
  t.is(res.status, 206);
  t.is(res.headers.get("Cache-Control"), "max-age=3600");
  t.is(res.headers.get("CF-Cache-Status"), "HIT");
  const contentType = res.headers.get("Content-Type");
  assert(contentType !== null);
  const [brand, boundary] = contentType.split("=");
  t.is(brand, "multipart/byteranges; boundary");
  t.is(
    await res.text(),
    [
      `--${boundary}`,
      "Content-Type: text/plain",
      "Content-Range: bytes 1-3/10",
      "",
      "123",
      `--${boundary}`,
      "Content-Type: text/plain",
      "Content-Range: bytes 5-6/10",
      "",
      "56",
      `--${boundary}--`,
    ].join("\r\n")
  );

  // Check with unsatisfiable range
  res = await cache.match(
    new Request(key, { headers: { Range: "bytes=15-" } })
  );
  assert(res !== undefined);
  t.is(res.status, 416);
});

const expireMacro = test.macro({
  title(providedTitle) {
    return `expires after ${providedTitle}`;
  },
  async exec(t, opts: { headers: HeadersInit; expectedTtl: number }) {
    const cache = t.context.caches.default;

    // Reset clock to known time, restoring afterwards.
    // Note this macro must be used with `test.serial` to avoid races.
    const originalTimestamp = t.context.timers.timestamp;
    t.teardown(() => (t.context.timers.timestamp = originalTimestamp));
    t.context.timers.timestamp = 1_000_000; // 1000s

    const key = "http://localhost/cache-expire";
    await cache.put(key, new Response("body", { headers: opts.headers }));

    let res = await cache.match(key);
    t.is(res?.status, 200);

    t.context.timers.timestamp += opts.expectedTtl / 2;
    res = await cache.match(key);
    t.is(res?.status, 200);

    t.context.timers.timestamp += opts.expectedTtl / 2;
    res = await cache.match(key);
    t.is(res, undefined);
  },
});
test.serial("Expires", expireMacro, {
  headers: {
    Expires: new Date(1000000 + 2000).toUTCString(),
  },
  expectedTtl: 2000,
});
test.serial("Cache-Control's max-age", expireMacro, {
  headers: { "Cache-Control": "max-age=1" },
  expectedTtl: 1000,
});
test.serial("Cache-Control's s-maxage", expireMacro, {
  headers: { "Cache-Control": "s-maxage=1, max-age=10" },
  expectedTtl: 1000,
});

const isCachedMacro = test.macro({
  title(providedTitle) {
    return `put ${providedTitle}`;
  },
  async exec(t, opts: { headers: Record<string, string>; cached: boolean }) {
    const cache = t.context.caches.default;

    // Use different key for each invocation of this macro
    const headersHash = crypto
      .createHash("sha1")
      .update(JSON.stringify(opts.headers))
      .digest("hex");
    const key = `http://localhost/cache-is-cached-${headersHash}`;

    const expires = new Date(t.context.timers.timestamp + 2000).toUTCString();
    const resToCache = new Response("body", {
      headers: { ...opts.headers, Expires: expires },
    });
    await cache.put(key, resToCache);
    const res = await cache.match(key);
    t.is(res?.status, opts.cached ? 200 : undefined);
  },
});
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

test("delete returns if deleted", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-delete";
  const resToCache = new Response("body", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache);

  // Check first delete deletes
  let deleted = await cache.delete(key);
  t.true(deleted);

  // Check subsequent deletes don't match
  deleted = await cache.delete(key);
  t.false(deleted);
});

test("operations respect cf.cacheKey", async (t) => {
  const cache = t.context.caches.default;
  const key = "http://localhost/cache-cf-key-unused";

  // Check put respects `cf.cacheKey`
  const key1 = new Request(key, { cf: { cacheKey: "1" } });
  const key2 = new Request(key, { cf: { cacheKey: "2" } });
  const resToCache1 = new Response("body1", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  const resToCache2 = new Response("body2", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key1, resToCache1);
  await cache.put(key2, resToCache2);

  // Check match respects `cf.cacheKey`
  const res1 = await cache.match(key1);
  t.is(await res1?.text(), "body1");
  const res2 = await cache.match(key2);
  t.is(await res2?.text(), "body2");

  // Check delete respects `cf.cacheKey`
  const deleted1 = await cache.delete(key1);
  t.true(deleted1);
  const deleted2 = await cache.delete(key2);
  t.true(deleted2);
});
test.serial("operations log warning on workers.dev subdomain", async (t) => {
  // Set option, then reset after test
  await t.context.setOptions({ cacheWarnUsage: true });
  t.teardown(() => t.context.setOptions({}));
  t.context.caches = await t.context.mf.getCaches();

  const cache = t.context.caches.default;
  const key = "http://localhost/cache-workers-dev-warning";

  t.context.log.logs = [];
  const resToCache = new Response("body", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache.clone());
  t.deepEqual(t.context.log.logsAtLevel(LogLevel.WARN), [
    "Cache operations will have no impact if you deploy to a workers.dev subdomain!",
  ]);

  // Check only warns once
  t.context.log.logs = [];
  await cache.put(key, resToCache);
  t.deepEqual(t.context.log.logsAtLevel(LogLevel.WARN), []);
});
test.serial("operations persist cached data", async (t) => {
  // Create new temporary file-system persistence directory
  const tmp = await useTmp(t);
  const storage = createFileStorage(path.join(tmp, "default"));
  const kvStorage = new KeyValueStorage(storage, t.context.timers);

  // Set option, then reset after test
  await t.context.setOptions({ cachePersist: tmp });
  t.teardown(() => t.context.setOptions({}));
  t.context.caches = await t.context.mf.getCaches();

  const cache = t.context.caches.default;
  const key = "http://localhost/cache-persist";

  // Check put respects persist
  const resToCache = new Response("body", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache);
  let stored = await kvStorage.get(key);
  assert(stored?.value !== undefined);
  t.deepEqual(await text(stored.value), "body");

  // Check match respects persist
  const res = await cache.match(key);
  t.is(res?.status, 200);
  t.is(await res?.text(), "body");

  // Check delete respects persist
  const deleted = await cache.delete(key);
  t.true(deleted);
  stored = await kvStorage.get(key);
  t.is(stored, null);
});
test.serial("operations are no-ops when caching disabled", async (t) => {
  // Set option, then reset after test
  await t.context.setOptions({ cache: false });
  t.teardown(() => t.context.setOptions({}));
  t.context.caches = await t.context.mf.getCaches();

  const cache = t.context.caches.default;
  const key = "http://localhost/cache-disabled";

  // Check match never matches
  const resToCache = new Response("body", {
    headers: { "Cache-Control": "max-age=3600" },
  });
  await cache.put(key, resToCache.clone());
  const res = await cache.match(key);
  t.is(res, undefined);

  // Check delete never deletes
  await cache.put(key, resToCache);
  const deleted = await cache.delete(key);
  t.false(deleted);
});

test("default and named caches are disjoint", async (t) => {
  const key = "http://localhost/cache-disjoint";
  const defaultCache = t.context.caches.default;
  const namedCache1 = await t.context.caches.open("1");
  const namedCache2 = await t.context.caches.open("2");

  // Check put respects cache name
  const init: RequestInit = { headers: { "Cache-Control": "max-age=3600" } };
  await defaultCache.put(key, new Response("bodyDefault", init));
  await namedCache1.put(key, new Response("body1", init));
  await namedCache2.put(key, new Response("body2", init));

  // Check match respects cache name
  const resDefault = await defaultCache.match(key);
  const res1 = await namedCache1.match(key);
  const res2 = await namedCache2.match(key);

  t.is(await resDefault?.text(), "bodyDefault");
  t.is(await res1?.text(), "body1");
  t.is(await res2?.text(), "body2");

  // Check delete respects cache name
  const deletedDefault = await defaultCache.delete(key);
  const deleted1 = await namedCache1.delete(key);
  const deleted2 = await namedCache2.delete(key);
  t.true(deletedDefault);
  t.true(deleted1);
  t.true(deleted2);
});
