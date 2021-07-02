import { existsSync, promises as fs } from "fs";
import path from "path";
import test from "ava";
import { Cache, CachedResponse, NoOpLog, Response } from "../../src";
import { KVStorageFactory } from "../../src/kv/helpers";
import { CacheModule } from "../../src/modules/cache";
import { runInWorker, useTmp } from "../helpers";

const testResponse = new Response("value", {
  headers: { "Cache-Control": "max-age=3600" },
});

test("getCache: creates persistent cache at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
  const cache = module.getCache("test", true);
  await cache.put("http://localhost:8787/", testResponse.clone());
  t.true(existsSync(path.join(tmp, "test", "http___localhost_8787_.json")));
  t.is(await (await cache.match("http://localhost:8787/"))?.text(), "value");
});
test("getCache: creates persistent cache at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new CacheModule(
    new NoOpLog(),
    new KVStorageFactory(tmpDefault)
  );
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
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
  const cache = module.getCache("test");
  await cache.put("http://localhost:8787/", testResponse.clone());
  t.false(existsSync(path.join(tmp, "test", "http___localhost_8787_.json")));
  t.is(await (await cache.match("http://localhost:8787/"))?.text(), "value");
});
test("getCache: reuses existing storage for in-memory cache", async (t) => {
  const tmp = await useTmp(t);
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
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
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
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
  const module = new CacheModule(
    new NoOpLog(),
    new KVStorageFactory(tmpDefault)
  );
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
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
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
  const module = new CacheModule(new NoOpLog(), new KVStorageFactory(tmp));
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
    headers: {
      "Cache-Control": ["max-age=3600"],
      "CF-Cache-Status": ["HIT"],
    },
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
