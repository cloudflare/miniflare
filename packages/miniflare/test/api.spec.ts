import { AddressInfo } from "net";
import { Log, LogLevel } from "@miniflare/shared";
import { interceptConsoleLogs } from "@miniflare/shared-test";
import test from "ava";
import { Miniflare, VariedStorageFactory } from "miniflare";
import { fetch } from "undici";

function clearArray(arr: any[]): void {
  arr.splice(0, arr.length);
}

test.serial("Miniflare: gets log from options", async (t) => {
  const logs = interceptConsoleLogs(t);

  let mf = new Miniflare({ script: "//" });
  await mf.getPlugins();
  clearArray(logs);
  mf.log.info("info");
  mf.log.debug("debug");
  mf.log.verbose("verbose");
  t.deepEqual(logs, []); // Defaults to NoOpLog

  mf = new Miniflare({ script: "//", log: new Log(LogLevel.DEBUG) });
  await mf.getPlugins();
  clearArray(logs);
  mf.log.info("info");
  mf.log.debug("debug");
  mf.log.verbose("verbose");
  t.deepEqual(logs, ["[mf:inf] info", "[mf:dbg] debug"]);
});
test.serial("Miniflare: dispose: disposes plugins and storage", async (t) => {
  const logs = interceptConsoleLogs(t);
  const mf = new Miniflare({
    script: "//",
    log: new Log(LogLevel.VERBOSE),
  });
  await mf.getPlugins();
  clearArray(logs);

  // Check we're also closing storage connections
  const originalDispose = VariedStorageFactory.prototype.dispose;
  t.teardown(() => (VariedStorageFactory.prototype.dispose = originalDispose));
  VariedStorageFactory.prototype.dispose = function () {
    mf.log.verbose("Disposing storage...");
    return originalDispose.bind(this)();
  };

  await mf.dispose();
  t.deepEqual(logs, [
    "[mf:vrb] - dispose(DurableObjectsPlugin)",
    "[mf:vrb] - dispose(WebSocketPlugin)",
    "[mf:vrb] Disposing storage...",
  ]);
});
test("Miniflare: getKVNamespace: gets KV namespace", async (t) => {
  const mf = new Miniflare({
    script: `export default { 
      fetch: async (request, env) => new Response(await env.TEST_NAMESPACE.get("key")),
    }`,
    modules: true,
    kvNamespaces: ["TEST_NAMESPACE"],
  });
  const ns = await mf.getKVNamespace("TEST_NAMESPACE");
  await ns.put("key", "value");
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "value");
});
test("Miniflare: getCaches: gets CacheStorage instance", async (t) => {
  const mf = new Miniflare({ script: "//" });
  const caches = await mf.getCaches();
  const globalScope = await mf.getGlobalScope();
  t.is(caches, globalScope.caches);
});
test("Miniflare: getDurableObjectNamespace: gets Durable Object namespace", async (t) => {
  const mf = new Miniflare({
    script: `export class TestObject {
      async fetch(request) {
        return new Response("body");
      }
    }`,
    modules: true,
    durableObjects: { TEST: "TestObject" },
  });
  const ns = await mf.getDurableObjectNamespace("TEST");
  const stub = ns.get(ns.newUniqueId());
  const res = await stub.fetch("http://localhost/");
  t.is(await res.text(), "body");
});
test("Miniflare: getDurableObjectStorage: gets Durable Object storage for object with ID", async (t) => {
  const mf = new Miniflare({
    script: `export class TestObject {
      constructor(state) {
        this.storage = state.storage;
      }
      async fetch(request) {
        return new Response(await this.storage.get("key"));
      }
    }`,
    modules: true,
    durableObjects: { TEST: "TestObject" },
  });
  const ns = await mf.getDurableObjectNamespace("TEST");
  const id = ns.newUniqueId();

  const storage = await mf.getDurableObjectStorage(id);
  await storage.put("key", "value");

  const stub = ns.get(id);
  const res = await stub.fetch("http://localhost/");
  t.is(await res.text(), "value");
});
test("Miniflare: createServer: creates HTTP server", async (t) => {
  const mf = new Miniflare({
    script: `export default { 
      fetch: async () => new Response("body"),
    }`,
    modules: true,
  });
  const server = await mf.createServer();
  const port = await new Promise((resolve) => {
    server.listen(0, () => {
      t.teardown(() => server.close());
      const port = (server.address() as AddressInfo).port;
      resolve(port);
    });
  });
  const res = await fetch(`http://localhost:${port}/`);
  t.is(await res.text(), "body");
});
test.serial("Miniflare: startServer: starts HTTP server", async (t) => {
  const logs = interceptConsoleLogs(t);
  const mf = new Miniflare({
    script: `export default { 
      fetch: async () => new Response("body"),
    }`,
    modules: true,
    port: 0,
    log: new Log(LogLevel.INFO),
  });
  await mf.getPlugins();
  clearArray(logs);

  const server = await mf.startServer();
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://localhost:${port}/`);
  t.is(await res.text(), "body");
  t.is(logs[0], "[mf:inf] Listening on :0");
  t.regex(logs[logs.length - 1], /^GET \/ 200 OK/);
});
test.serial("Miniflare: startScheduler: starts CRON scheduler", async (t) => {
  t.plan(2); // expression is "* * * * *" and callback
  const mf = new Miniflare({
    globals: { callback: () => t.pass() },
    script: `export default { 
      scheduled: callback,
    }`,
    modules: true,
    crons: ["* * * * *"],
  });
  // Wait for plugins to load, this includes CRON validation
  await mf.getPlugins();

  const {
    TimerBasedCronScheduler,
  }: typeof import("cron-schedule") = require("cron-schedule");
  const originalSetInterval = TimerBasedCronScheduler.setInterval;
  t.teardown(() => (TimerBasedCronScheduler.setInterval = originalSetInterval));
  TimerBasedCronScheduler.setInterval = (expression, func) => {
    t.is(expression.toString(), "* * * * *");
    // Immediately invoke the task because we're impatient
    func();
    return 0 as any;
  };
  await mf.startScheduler();
});
