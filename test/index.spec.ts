import { promises as fs } from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import test, { ExecutionContext } from "ava";
import WebSocket from "ws";
import { Miniflare, MiniflareError, Response, ScheduledEvent } from "../src";
import { stringScriptPath } from "../src/options";
import { TestLog, triggerPromise, useTmp, within } from "./helpers";

function interceptConsoleLogs(t: ExecutionContext): string[] {
  const logs: string[] = [];
  const originalLog = console.log;
  t.teardown(() => (console.log = originalLog));
  console.log = (...args: string[]) => logs.push(args.join(" "));
  return logs;
}

// .serial required for intercepting console.log
test.serial(
  "constructor: defaults to no logging, throwing errors",
  async (t) => {
    const tmp = await useTmp(t);
    const logs = interceptConsoleLogs(t);
    const wranglerConfigPath = path.join(tmp, "wrangler.toml"); // Non-existent
    const relativeWranglerConfigPath = path.relative("", wranglerConfigPath);
    const mf = new Miniflare({
      script: "// test",
      wranglerConfigPath,
    });
    await t.throwsAsync(mf.getOptions(), {
      instanceOf: MiniflareError,
      // Make sure " (defaulting to empty string)" not included
      message: `Unable to read ${relativeWranglerConfigPath}: Error: ENOENT: no such file or directory, open '${wranglerConfigPath}'`,
    });
    t.deepEqual(logs, []);
  }
);
test.serial(
  "constructor: defaults to console logging if logging enabled",
  async (t) => {
    const logs = interceptConsoleLogs(t);
    const mf = new Miniflare({ log: true, script: "// test" });
    await mf.getOptions(); // Wait for worker to load
    t.deepEqual(logs, ["[mf:inf] Worker reloaded!"]);
  }
);

test("reloadOptions: reloads options manually", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "script.mjs");
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(
    scriptPath,
    `export default { fetch: (request, env) => new Response(env.KEY) }`
  );
  await fs.writeFile(envPath, "KEY=value1");
  const mf = new Miniflare({ modules: true, scriptPath, envPath });
  let res = await mf.dispatchFetch("http://localhost:8787/");
  t.is(await res.text(), "value1");

  await fs.writeFile(envPath, "KEY=value2");
  await mf.reloadOptions();
  res = await mf.dispatchFetch("http://localhost:8787/");
  t.is(await res.text(), "value2");
});

test("getOptions: gets processed options", async (t) => {
  const mf = new Miniflare({ script: "// test" });
  const options = await mf.getOptions();
  t.is(options.scriptPath, stringScriptPath);
  t.is(options.scripts?.[stringScriptPath]?.code, "// test");
});

// dispatchFetch/dispatchScheduled tested in ./modules/events.spec.ts
test("getCache: gets cache for manipulation", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `
    export default {
      async fetch(request) {
        const url = new URL(request.url);
        const cache = caches.default;
        if(url.pathname === "/put") {
          await cache.put("https://miniflare.dev/", new Response("1", {
            headers: { "Cache-Control": "max-age=3600" },
          }));
        }
        return cache.match("https://miniflare.dev/");
      }
    }`,
  });
  let res = await mf.dispatchFetch("http://localhost:8787/put");
  t.is(await res.text(), "1");

  const cache = await mf.getCache();
  const cachedRes = await cache.match("https://miniflare.dev/");
  t.is(await cachedRes?.text(), "1");

  await cache.put(
    "https://miniflare.dev",
    new Response("2", {
      headers: { "Cache-Control": "max-age=3600" },
    })
  );
  res = await mf.dispatchFetch("http://localhost:8787");
  t.is(await res.text(), "2");
});
test("getKVNamespace: gets KV namespace for manipulation", async (t) => {
  const mf = new Miniflare({
    modules: true,
    kvNamespaces: ["TEST_NAMESPACE"],
    script: `
    export default {
      async fetch(request, env) {
        const url = new URL(request.url);
        if(url.pathname === "/put") await env.TEST_NAMESPACE.put("key", "1");
        return new Response(await env.TEST_NAMESPACE.get("key"));
      }
    }`,
  });
  let res = await mf.dispatchFetch("http://localhost:8787/put");
  t.is(await res.text(), "1");

  const ns = await mf.getKVNamespace("TEST_NAMESPACE");
  t.is(await ns.get("key"), "1");

  await ns.put("key", "2");
  res = await mf.dispatchFetch("http://localhost:8787");
  t.is(await res.text(), "2");
});
test("getDurableObjectNamespace: gets Durable Object namespace for manipulation", async (t) => {
  const mf = new Miniflare({
    modules: true,
    durableObjects: { TEST_OBJECT: "TestObject" },
    script: `
    export class TestObject {
      constructor(state) {
        this.storage = state.storage;
      }
      
      async fetch(request) {
        const url = new URL(request.url);
        if(url.pathname === "/put") await this.storage.put("key", 1);
        return new Response((await this.storage.get("key")).toString());
      }
    }
    
    export default {
      async fetch(request, env) {
        const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.idFromName("test"));
        return stub.fetch(request);
      }
    }`,
  });
  let res = await mf.dispatchFetch("http://localhost:8787/put");
  t.is(await res.text(), "1");

  const ns = await mf.getDurableObjectNamespace("TEST_OBJECT");
  const stub = ns.get(ns.idFromName("test"));
  const doRes = await stub.fetch("http://localhost:8787/put");
  t.is(await doRes.text(), "1");

  const storage = await stub.storage();
  t.is(await storage.get("key"), 1);
  await storage.put("key", 2);

  res = await mf.dispatchFetch("http://localhost:8787");
  t.is(await res.text(), "2");
});

function listen(t: ExecutionContext, server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      t.teardown(() => server.close());
      const port = (server.address() as AddressInfo).port;
      resolve(`localhost:${port}`);
    });
  });
}

function request(path: string): Promise<[string, http.IncomingHttpHeaders]> {
  return new Promise((resolve) => {
    http.get(`http://${path}`, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve([body, res.headers]));
    });
  });
}

test("createServer: handles string http worker response", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default { fetch: () => new Response("string") }`,
  });
  const origin = await listen(t, mf.createServer());
  const [body] = await request(origin);
  t.is(body, "string");
});
test("createServer: handles buffer http worker response", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default {
      fetch: () => new Response(new TextEncoder().encode("buffer").buffer)
    }`,
  });
  const origin = await listen(t, mf.createServer());
  const [body] = await request(origin);
  t.is(body, "buffer");
});
test("createServer: handles stream http worker response", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default {
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue("str");
          controller.enqueue("eam");
          controller.close();
        },
      }))
    }`,
  });
  const origin = await listen(t, mf.createServer());
  const [body] = await request(origin);
  t.is(body, "stream");
});
test("createServer: includes cf headers on request", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default {
      fetch(request) {
        const headers = [...request.headers.entries()].reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
        return new Response(
          JSON.stringify(headers),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }`,
  });
  const origin = await listen(t, mf.createServer());
  const body = JSON.parse((await request(origin))[0]);
  t.is(body["cf-connecting-ip"], "127.0.0.1");
  t.is(body["cf-ipcountry"], "XX");
  t.is(body["cf-ray"], "");
  t.is(body["cf-request-id"], "");
  t.is(body["cf-visitor"], `{"scheme":"http"}`);
});
test("createServer: includes cf property on request", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default {
      fetch(request) {
        return new Response(
          JSON.stringify(request.cf),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }`,
  });
  const origin = await listen(t, mf.createServer());
  const body = JSON.parse((await request(origin))[0]);
  t.deepEqual(body, {
    asn: 0,
    colo: "XXX",
    country: "XX",
    httpProtocol: "HTTP/1.1",
    requestPriority: null,
    tlsCipher: "",
    tlsClientAuth: null,
    tlsVersion: "",
    timezone: "",
  });
});
test("createServer: handles scheduled event trigger over http", async (t) => {
  const events: ScheduledEvent[] = [];
  const mf = new Miniflare({
    bindings: {
      eventCallback(event: ScheduledEvent) {
        events.push(event);
      },
    },
    script: `addEventListener("scheduled", eventCallback)`,
  });
  const origin = await listen(t, mf.createServer());
  // Wait for watcher initPromise before sending requests
  await mf.getOptions();

  await request(`${origin}/.mf/scheduled`);
  t.is(events.length, 1);
  within(t, 3000, events[0].scheduledTime, Date.now());
  t.is(events[0].cron, "");

  await request(`${origin}/.mf/scheduled?time=1000`);
  t.is(events.length, 2);
  t.is(events[1].scheduledTime, 1000);
  t.is(events[1].cron, "");

  await request(`${origin}/.mf/scheduled?time=1000&cron=* * * * *`);
  t.is(events.length, 3);
  t.is(events[2].scheduledTime, 1000);
  t.is(events[2].cron, "* * * * *");
});
test("createServer: displays pretty error page", async (t) => {
  const log = new TestLog();
  const mf = new Miniflare({
    modules: true,
    script: `export default { fetch: () => { throw new Error("test error text"); } }`,
    log,
  });
  const origin = await listen(t, mf.createServer());
  const [body, headers] = await request(origin);
  t.is(headers["content-type"], "text/html; charset=UTF-8");
  t.regex(body, /^<!DOCTYPE html>/);
  t.regex(body, /test error text/);
  t.regex(log.errors[0], /^GET \/: Error: test error text/);
});
test("createServer: handles web socket upgrades", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: `export default {
      fetch(request) {
        const [client, worker] = Object.values(new WebSocketPair());
        
        worker.accept();
        worker.addEventListener("message", (e) => {
          worker.send(\`worker:\${e.data}\`);
        });
      
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
    }`,
  });
  const origin = await listen(t, mf.createServer());
  // Wait for watcher initPromise before sending requests
  await mf.getOptions();
  const ws = new WebSocket(`ws://${origin}`);
  const [eventTrigger, eventPromise] = triggerPromise<string>();
  ws.addEventListener("message", (e) => {
    eventTrigger(e.data);
  });
  ws.addEventListener("open", () => {
    ws.send("hello");
  });
  t.is(await eventPromise, "worker:hello");
});
test("createServer: expects status 101 and web socket response for upgrades", async (t) => {
  const log = new TestLog();
  const mf = new Miniflare({
    modules: true,
    script: `export default { fetch: () => new Response("test") }`,
    log,
  });
  const origin = await listen(t, mf.createServer());
  // Wait for watcher initPromise before sending requests
  await mf.getOptions();

  const ws = new WebSocket(`ws://${origin}`);

  const [eventTrigger, eventPromise] = triggerPromise<{
    code: number;
    reason: string;
  }>();
  ws.addEventListener("close", eventTrigger);
  const event = await eventPromise;

  t.deepEqual(log.errors, [
    "Web Socket request did not return status 101 Switching Protocols response with Web Socket",
  ]);
  t.is(event.code, 1002);
  t.is(event.reason, "Protocol Error");
});
// TODO: HTTPS tests
