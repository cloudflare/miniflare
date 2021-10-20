// noinspection HttpUrlsUsage

import http from "http";
import https from "https";
import { AddressInfo } from "net";
import { Readable } from "stream";
import {
  BindingsPlugin,
  IncomingRequestCfProperties,
  Request,
  ScheduledEvent,
  inputGatedFetch,
} from "@miniflare/core";
import {
  HTTPPlugin,
  RequestMeta,
  convertNodeRequest,
  createRequestListener,
  createServer,
} from "@miniflare/http-server";
import { LogLevel } from "@miniflare/shared";
import {
  TestLog,
  isWithin,
  triggerPromise,
  useMiniflare,
  useMiniflareWithHandler,
  useTmp,
} from "@miniflare/shared-test";
import { MessageEvent, WebSocketPlugin } from "@miniflare/web-sockets";
import test, { ExecutionContext } from "ava";
import StandardWebSocket from "ws";

function listen(
  t: ExecutionContext,
  server: http.Server | https.Server
): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      t.teardown(() => server.close());
      const port = (server.address() as AddressInfo).port;
      resolve(port);
    });
  });
}

function buildConvertNodeRequest(
  t: ExecutionContext,
  options: http.RequestOptions & {
    upstream?: string;
    meta?: RequestMeta;
    body?: NodeJS.ReadableStream;
  } = {}
): Promise<[Request, URL]> {
  return new Promise(async (resolve) => {
    const server = http.createServer(async (req, res) => {
      const { request, url } = await convertNodeRequest(
        req,
        options.upstream,
        options.meta
      );
      resolve([request, url]);
      res.end();
    });
    const port = await listen(t, server);
    const req = http.request({ host: "localhost", port, ...options });
    if (options?.body) options.body.pipe(req, { end: true });
    else req.end();
  });
}

function request(
  port: number,
  path?: string,
  headers?: http.OutgoingHttpHeaders,
  secure?: boolean
): Promise<[string, http.IncomingHttpHeaders]> {
  return new Promise((resolve) => {
    (secure ? https : http).get(
      {
        protocol: secure ? "https:" : "http:",
        host: "localhost",
        port,
        path,
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve([body, res.headers]));
      }
    );
  });
}

test("convertNodeRequest: uses request url, with upstream or host as base", async (t) => {
  let [, url] = await buildConvertNodeRequest(t, {
    path: "/test",
    upstream: "http://upstream.com",
  });
  t.is(url.toString(), "http://upstream.com/test");

  [, url] = await buildConvertNodeRequest(t, { path: "/test" });
  t.regex(url.toString(), /^http:\/\/localhost:\d+\/test$/);
});
test("convertNodeRequest: builds requests without bodies", async (t) => {
  const [req] = await buildConvertNodeRequest(t);
  t.is(req.body, null);
});
test("convertNodeRequest: buffers non-chunked request bodies", async (t) => {
  // Start server to check transfer encoding and chunks received by upstream
  let headers: http.IncomingHttpHeaders | undefined;
  let chunks: string[] = [];
  const server = http.createServer((req, res) => {
    headers = req.headers;
    chunks = [];
    // noinspection TypeScriptValidateJSTypes
    req.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
    req.on("end", () => res.end());
  });
  const port = await listen(t, server);

  // Check Transfer-Encoding chunked remains remains chunked
  let body = new Readable({ read() {} });
  body.push("a");
  body.push("b");
  body.push(null);
  let [req] = await buildConvertNodeRequest(t, {
    method: "POST",
    headers: { "transfer-encoding": "chunked" },
    upstream: `http://localhost:${port}`,
    body,
  });
  await (await inputGatedFetch(req)).text();
  t.is(headers?.["transfer-encoding"], "chunked");
  t.deepEqual(chunks, ["a", "b"]);

  // Check request with no Transfer-Encoding gets buffered
  body = new Readable({ read() {} });
  body.push("a");
  body.push("b");
  body.push(null);
  [req] = await buildConvertNodeRequest(t, {
    method: "POST",
    headers: { "content-length": "2" },
    upstream: `http://localhost:${port}`,
    body,
  });
  await (await inputGatedFetch(req)).text();
  t.not(headers?.["transfer-encoding"], "chunked");
  t.deepEqual(chunks, ["ab"]);
});
test("convertNodeRequest: builds headers with multiple values", async (t) => {
  const [req] = await buildConvertNodeRequest(t, {
    headers: { Authorization: "Bearer token", "X-Key": ["value1", "value2"] },
  });
  t.is(req.headers.get("authorization"), "Bearer token");
  t.is(req.headers.get("x-key"), "value1, value2");
});
test("convertNodeRequest: removes unsupported fetch headers", async (t) => {
  const body = new Readable({ read() {} });
  body.push("a");
  body.push("b");
  body.push(null);
  const [req] = await buildConvertNodeRequest(t, { method: "POST", body });
  t.false(req.headers.has("transfer-encoding"));
  t.false(req.headers.has("connection"));
  t.false(req.headers.has("keep-alive"));
  t.false(req.headers.has("expect"));
});
test("convertNodeRequest: includes cf headers on request", async (t) => {
  let [req] = await buildConvertNodeRequest(t);
  t.is(req.headers.get("x-forwarded-proto"), "https");
  t.is(req.headers.get("x-real-ip"), "127.0.0.1");
  t.is(req.headers.get("cf-connecting-ip"), "127.0.0.1");
  t.is(req.headers.get("cf-ipcountry"), "US");
  t.regex(req.headers.get("cf-ray") ?? "", /^[a-z0-9]{16}$/);
  t.is(req.headers.get("cf-visitor"), '{"scheme":"https"}');

  // Check overridden by meta object
  [req] = await buildConvertNodeRequest(t, {
    meta: {
      forwardedProto: "http",
      realIp: "1.1.1.1",
      cf: { country: "GB" } as any,
    },
  });
  t.is(req.headers.get("x-forwarded-proto"), "http");
  t.is(req.headers.get("x-real-ip"), "1.1.1.1");
  t.is(req.headers.get("cf-connecting-ip"), "1.1.1.1");
  t.is(req.headers.get("cf-ipcountry"), "GB");
  t.is(req.headers.get("cf-visitor"), '{"scheme":"http"}');
});
test("convertNodeRequest: includes cf object on request", async (t) => {
  const cf: IncomingRequestCfProperties = { colo: "LHR", country: "GB" } as any;
  const [req] = await buildConvertNodeRequest(t, { meta: { cf } });
  t.not(req.cf, cf);
  t.deepEqual(req.cf, cf);
});

test("createRequestListener: gets cf object from custom provider", async (t) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {
      metaProvider: (req) => ({
        cf: { httpProtocol: `HTTP/${req.httpVersion}` } as any,
      }),
    },
    (globals, req) => {
      return new globals.Response(JSON.stringify(req.cf), {
        headers: { "Content-Type": "application/json" },
      });
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(JSON.parse(body).httpProtocol, "HTTP/1.1");
});
test("createRequestListener: handles string http worker response", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response("string");
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(body, "string");
});
test("createRequestListener: handles buffer http worker response", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response(new TextEncoder().encode("buffer").buffer);
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(body, "buffer");
});
test("createRequestListener: handles stream http worker response", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response(
      new globals.ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          controller.enqueue("str");
          controller.enqueue("eam");
          controller.close();
        },
      })
    );
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(body, "stream");
});
test("createRequestListener: handles empty http worker response", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response();
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(body, "");
});
test("createRequestListener: handles http headers in response", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    const headers = new globals.Headers();
    headers.append("X-Message", "test");
    headers.append("Set-Cookie", "test1=value1");
    headers.append("Set-Cookie", "test2=value2");
    return new globals.Response("string", { headers });
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body, headers] = await request(port);
  t.is(body, "string");
  t.like(headers, {
    "x-message": "test",
    "set-cookie": ["test1=value1", "test2=value2"],
  });
});
test("createRequestListener: handles scheduled event trigger over http", async (t) => {
  const events: ScheduledEvent[] = [];
  const mf = useMiniflare(
    { HTTPPlugin, BindingsPlugin },
    {
      globals: { eventCallback: (event: ScheduledEvent) => events.push(event) },
      script: `addEventListener("scheduled", eventCallback)`,
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));

  await request(port, "/cdn-cgi/mf/scheduled");
  t.is(events.length, 1);
  isWithin(t, 3000, events[0].scheduledTime, Date.now());
  t.is(events[0].cron, "");

  await request(port, "/cdn-cgi/mf/scheduled?time=1000");
  t.is(events.length, 2);
  t.is(events[1].scheduledTime, 1000);
  t.is(events[1].cron, "");

  await request(port, "/cdn-cgi/mf/scheduled?time=1000&cron=*+*+*+*+*");
  t.is(events.length, 3);
  t.is(events[2].scheduledTime, 1000);
  t.is(events[2].cron, "* * * * *");
});
test("createRequestListener: displays appropriately-formatted error page", async (t) => {
  const log = new TestLog();
  log.error = (message) =>
    log.logWithLevel(LogLevel.ERROR, message?.stack ?? "");
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    () => {
      throw new Error("test error text");
    },
    log
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));

  // Check plain text response returned normally
  let [body, headers] = await request(port, "/");
  t.is(headers["content-type"], "text/plain; charset=UTF-8");
  t.regex(body, /^Error: test error text/);
  t.regex(
    log.logsAtLevel(LogLevel.ERROR)[0],
    /^GET \/: Error: test error text/
  );

  // Check pretty HTML error page returned with "Accept: text/html"
  log.logs = [];
  [body, headers] = await request(port, "/", { accept: "text/html" });
  t.is(headers["content-type"], "text/html; charset=UTF-8");
  t.regex(body, /^<!DOCTYPE html>/);
  t.regex(body, /test error text/);
  t.regex(
    log.logsAtLevel(LogLevel.ERROR)[0],
    /^GET \/: Error: test error text/
  );
  // Check with other Accept values
  [, headers] = await request(port, "/", { accept: "tEXt/*" });
  t.is(headers["content-type"], "text/html; charset=UTF-8");
  [, headers] = await request(port, "/", { accept: "image/png, */*" });
  t.is(headers["content-type"], "text/html; charset=UTF-8");
});

test("createServer: handles regular requests", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response("body");
  });
  const port = await listen(t, await createServer(mf));
  const [body] = await request(port);
  t.is(body, "body");
});
test("createServer: handles web socket upgrades", async (t) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin },
    {},
    (globals) => {
      const [client, worker] = Object.values(new globals.WebSocketPair());
      worker.accept();
      worker.addEventListener("message", (e: MessageEvent) => {
        worker.send(`worker:${e.data}`);
      });
      return new globals.Response(null, {
        status: 101,
        webSocket: client,
      });
    }
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`);
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
  log.error = (message) => log.logWithLevel(LogLevel.ERROR, message.toString());
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    (globals) => new globals.Response("test"),
    log
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`);
  const [eventTrigger, eventPromise] = triggerPromise<{
    code: number;
    reason: string;
  }>();
  ws.addEventListener("close", eventTrigger);
  const event = await eventPromise;

  t.deepEqual(log.logsAtLevel(LogLevel.ERROR), [
    "TypeError: Web Socket request did not return status 101 Switching Protocols response with Web Socket",
  ]);
  t.is(event.code, 1002);
  t.is(event.reason, "Protocol Error");
});
test("createServer: handles https requests", async (t) => {
  const tmp = await useTmp(t);
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    { https: tmp },
    (globals) => new globals.Response("test")
  );
  const port = await listen(t, await createServer(mf));
  const [body] = await request(port, "", {}, true);
  t.is(body, "test");
});
