// noinspection HttpUrlsUsage

import { once } from "events";
import http from "http";
import https from "https";
import { AddressInfo } from "net";
import { Readable } from "stream";
import { buffer, text } from "stream/consumers";
import { ReadableStreamDefaultController, TransformStream } from "stream/web";
import { setTimeout } from "timers/promises";
import { URL } from "url";
import zlib from "zlib";
import { CachePlugin } from "@miniflare/cache";
import {
  BindingsPlugin,
  IncomingRequestCfProperties,
  Request,
  ScheduledEvent,
  fetch,
} from "@miniflare/core";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import {
  HTTPPlugin,
  RequestMeta,
  convertNodeRequest,
  createRequestListener,
  createServer,
} from "@miniflare/http-server";
import { LogLevel, getRequestContext } from "@miniflare/shared";
import {
  TestLog,
  isWithin,
  triggerPromise,
  useMiniflare,
  useMiniflareWithHandler,
  useServer,
  useTmp,
  utf8Encode,
} from "@miniflare/shared-test";
import {
  CloseEvent,
  MessageEvent,
  WebSocketPlugin,
} from "@miniflare/web-sockets";
import test, { ExecutionContext, Macro } from "ava";
import StandardWebSocket, {
  Data,
  CloseEvent as WebSocketCloseEvent,
  ErrorEvent as WebSocketErrorEvent,
  Event as WebSocketEvent,
  MessageEvent as WebSocketMessageEvent,
} from "ws";

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
    meta?: RequestMeta;
    body?: NodeJS.ReadableStream;
  } = {}
): Promise<[Request, URL]> {
  return new Promise(async (resolve) => {
    const server = http.createServer(async (req, res) => {
      const { request, url } = await convertNodeRequest(req, options.meta);
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
): Promise<[body: string, headers: http.IncomingHttpHeaders, status: number]> {
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
      async (res) => {
        const body = await text(res);
        resolve([body, res.headers, res.statusCode ?? 0]);
      }
    );
  });
}

test("convertNodeRequest: uses request url, with host as origin", async (t) => {
  // eslint-disable-next-line prefer-const
  let [request, url] = await buildConvertNodeRequest(t, {
    path: "/test",
    headers: { host: "upstream.com" },
  });
  t.is(request.headers.get("host"), "upstream.com");
  t.is(url.toString(), "http://upstream.com/test");

  [, url] = await buildConvertNodeRequest(t, { path: "/test" });
  t.regex(url.toString(), /^http:\/\/localhost:\d+\/test$/);
});
test("convertNodeRequest: builds requests without bodies", async (t) => {
  const [req] = await buildConvertNodeRequest(t);
  t.is(req.body, null);
});
test("convertNodeRequest: sends non-chunked request bodies", async (t) => {
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
    headers: { "transfer-encoding": "chunked", host: `localhost:${port}` },
    body,
  });
  await (await fetch(req)).text();
  t.is(headers?.["transfer-encoding"], "chunked");
  t.deepEqual(chunks, ["a", "b"]);

  // Check request with no Transfer-Encoding gets buffered
  body = new Readable({ read() {} });
  body.push("a");
  body.push("b");
  body.push(null);
  [req] = await buildConvertNodeRequest(t, {
    method: "POST",
    headers: { "content-length": "2", host: `localhost:${port}` },
    body,
  });
  await (await fetch(req)).text();
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
test("convertNodeRequest: includes fixed accept-encoding headers on request", async (t) => {
  const [req] = await buildConvertNodeRequest(t);
  t.is(req.headers.get("accept-encoding"), "gzip");

  const [req2] = await buildConvertNodeRequest(t, {
    headers: { "accept-encoding": "br" },
  });
  t.is(req2.headers.get("accept-encoding"), "gzip");
});
test("convertNodeRequest: includes acutual accept-encoding headers as cf.clientAcceptEncoding on request", async (t) => {
  const [req] = await buildConvertNodeRequest(t, {
    headers: { "accept-encoding": "br" },
    meta: { cf: {} as IncomingRequestCfProperties },
  });
  t.is(req.headers.get("accept-encoding"), "gzip");
  t.deepEqual(req.cf, {
    clientAcceptEncoding: "br",
  } as IncomingRequestCfProperties);
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
test('convertNodeRequest: defaults to "manual" redirect mode', async (t) => {
  const [req] = await buildConvertNodeRequest(t);
  t.is(req.redirect, "manual");
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
    return new globals.Response(
      new globals.TextEncoder().encode("buffer").buffer
    );
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port);
  t.is(body, "buffer");
});
test("createRequestListener: handles stream http worker response", async (t) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    { compatibilityFlags: ["streams_enable_constructors"] },
    (globals) => {
      return new globals.Response(
        new globals.ReadableStream({
          start(controller: ReadableStreamDefaultController) {
            const encoder = new globals.TextEncoder();
            controller.enqueue(encoder.encode("str"));
            controller.enqueue(encoder.encode("eam"));
            controller.close();
          },
        })
      );
    }
  );
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
    return new globals.Response("string", { status: 404, headers });
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body, headers, status] = await request(port);
  t.is(body, "string");
  t.like(headers, {
    "x-message": "test",
    "set-cookie": ["test1=value1", "test2=value2"],
  });
  t.is(status, 404);
});
test("createRequestListener: uses body length instead of Content-Length header", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/148
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, BindingsPlugin },
    { globals: { t } },
    (globals) => {
      const res = new globals.Response("body", {
        headers: { "Content-Length": "50" },
      });
      globals.t.is(res.headers.get("Content-Length"), "50");
      return res;
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body, headers] = await request(port);
  t.is(body, "body");
  t.is(headers["content-length"], "4");
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
test("createRequestListener: handles scheduled event triggers over http for mounts", async (t) => {
  const events: string[] = [];
  const mf = useMiniflare(
    { HTTPPlugin, BindingsPlugin },
    {
      globals: { events },
      script: `addEventListener("scheduled", () => events.push("parent"))`,
      mounts: {
        a: {
          routes: ["http://mount.mf/*"],
          globals: { events },
          script: `addEventListener("scheduled", () => events.push("child"))`,
        },
      },
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));

  await request(port, "/cdn-cgi/mf/scheduled");
  t.deepEqual(events, ["parent"]);

  await request(port, "/cdn-cgi/mf/scheduled", { host: "mount.mf" });
  t.deepEqual(events, ["parent", "child"]);
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

  // Check pretty HTML error page isn't returned for cURL
  [, headers] = await request(port, "/", {
    accept: "*/*",
    "user-agent": "curl/7.77.0",
  });
  t.is(headers["content-type"], "text/plain; charset=UTF-8");
});
test("createRequestListener: discards Content-Length header if invalid", async (t) => {
  // https://github.com/honojs/hono/issues/520
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    const res = new globals.Response("string");
    return new globals.Response(res.body, {
      headers: { "Content-Length": "undefined" },
    });
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body, headers] = await request(port);
  t.is(body, "string");
  t.is(headers["content-length"], undefined);
  t.is(headers["transfer-encoding"], "chunked");
});
test("createRequestListener: includes live reload script in html responses if enabled", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    return new globals.Response(
      '<!DOCTYPE html><html lang="en"><body><p>Test</p></body></html>',
      { headers: { "content-type": "text/html" } }
    );
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  let [body] = await request(port, "/");
  t.notRegex(body, /Miniflare Live Reload/);

  await mf.setOptions({ liveReload: true });
  [body] = await request(port, "/");
  t.regex(body, /Miniflare Live Reload/);
});
test("createRequestListener: includes live reload script in html error responses if enabled", async (t) => {
  const log = new TestLog();
  log.error = () => {};
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    () => {
      throw new Error();
    },
    log
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  let [body] = await request(port, "/", { accept: "text/html" });
  t.notRegex(body, /Miniflare Live Reload/);

  await mf.setOptions({ liveReload: true });
  [body] = await request(port, "/", { accept: "text/html" });
  t.regex(body, /Miniflare Live Reload/);
});
test("createRequestListener: updates Content-Length header if specified and live reload enabled", async (t) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    { liveReload: true },
    (globals) => {
      return new globals.Response("test", {
        headers: { "content-type": "text/html", "content-length": "4" },
      });
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body, headers] = await request(port, "/");
  t.not(headers["content-length"], "4");
  t.regex(body, /Miniflare Live Reload/);
  t.regex(body, /<\/script>/); // Check entire script included
});
test("createRequestListener: includes CF-* headers in html error response", async (t) => {
  const log = new TestLog();
  log.error = () => {};
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    () => {
      throw new Error();
    },
    log
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const [body] = await request(port, "/", { accept: "text/html" });
  t.regex(body, /CF-CONNECTING-IP/);
});

const longText = "".padStart(1024, "x");
const autoEncodeMacro: Macro<
  [encoding: string, decompress: (buffer: Buffer) => Buffer, encodes?: boolean]
> = async (t, encoding, decompress, encodes = true) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, BindingsPlugin },
    { bindings: { longText, encoding } },
    (globals) => {
      return new globals.Response(globals.longText, {
        headers: { "Content-Encoding": globals.encoding },
      });
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  return new Promise<void>((resolve) => {
    http.get({ port }, async (res) => {
      if (encodes) {
        t.is(res.headers["content-length"], undefined);
        t.is(res.headers["transfer-encoding"], "chunked");
      } else {
        t.not(res.headers["content-length"], undefined);
      }
      t.is(res.headers["content-encoding"], encoding);
      const compressed = await buffer(res);
      const decompressed = decompress(compressed);
      if (encodes) t.true(compressed.byteLength < decompressed.byteLength);
      t.is(decompressed.toString("utf8"), longText);
      resolve();
    });
  });
};
autoEncodeMacro.title = (providedTitle, encoding, decompress, encodes = true) =>
  `createRequestListener: ${
    encodes ? "auto-encodes" : "doesn't encode"
  } response with Content-Encoding: ${encoding}`;
test(autoEncodeMacro, "gzip", (buffer) => zlib.gunzipSync(buffer));
test(autoEncodeMacro, "deFlaTe", (buffer) => zlib.inflateSync(buffer));
test(autoEncodeMacro, "br", (buffer) => zlib.brotliDecompressSync(buffer));
test(autoEncodeMacro, "deflate, gZip", (buffer) =>
  zlib.inflateSync(zlib.gunzipSync(buffer))
);
// Should skip all encoding with single unknown encoding
test(autoEncodeMacro, "deflate, unknown, gzip", (buffer) => buffer, false);
// Should allow custom `Content-Encoding`s: https://github.com/cloudflare/miniflare/issues/312
test(autoEncodeMacro, "custom", (buffer) => buffer, false);
test("createRequestListener: skips encoding already encoded data", async (t) => {
  const encoded = new Uint8Array(zlib.gzipSync(Buffer.from(longText, "utf8")));
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, BindingsPlugin },
    { bindings: { encoded } },
    (globals) => {
      return new globals.Response(globals.encoded, {
        encodeBody: "manual",
        headers: {
          "Content-Length": globals.encoded.byteLength.toString(),
          "Content-Encoding": "gzip",
        },
      });
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  return new Promise<void>((resolve) => {
    http.get({ port }, async (res) => {
      t.is(res.headers["content-length"], encoded.byteLength.toString());
      t.is(res.headers["content-encoding"], "gzip");
      const compressed = await buffer(res);
      const decompressed = zlib.gunzipSync(compressed);
      t.true(compressed.byteLength < decompressed.byteLength);
      t.is(decompressed.toString("utf8"), longText);
      resolve();
    });
  });
});
test("createRequestListener: should allow connection close before stream finishes", async (t) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(utf8Encode("data: hello\n\n"));
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, BindingsPlugin },
    { globals: { readable } },
    (globals) => {
      return new globals.Response(globals.readable, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));
  const res = await new Promise<http.IncomingMessage>((resolve) => {
    http.get({ port }, resolve);
  });

  function waitForData(): Promise<string> {
    return new Promise((resolve) =>
      res.once("data", (chunk) => resolve(chunk.toString().trim()))
    );
  }

  t.is(await waitForData(), "data: hello");

  await writer.write(utf8Encode("data: test\n\n"));
  t.is(await waitForData(), "data: test");

  // Force-fully close the connection
  res.destroy();

  // Wait long enough for the stream to close
  await setTimeout(1000);
  // This shouldn't throw a premature close
  await writer.write(utf8Encode("data: test\n\n"));
});
test("createRequestListener: should include Content-Length header on responses", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/313
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals, req) => {
    const url = new globals.URL(req.url);
    if (url.pathname === "/content-encoding") {
      return new globals.Response("body", {
        headers: { "Content-Encoding": "custom", "Content-Length": "4" },
      });
    } else if (url.pathname === "/encode-body-manual") {
      return new globals.Response("body", {
        encodeBody: "manual",
        headers: { "Content-Length": "4" },
      });
    } else {
      return new globals.Response(null, { status: 404 });
    }
  });
  const port = await listen(t, http.createServer(createRequestListener(mf)));

  // Check with custom `Content-Encoding` (https://github.com/cloudflare/miniflare/issues/312)
  await new Promise<void>((resolve) => {
    http.get({ port, path: "/content-encoding" }, async (res) => {
      t.is(res.headers["content-length"], "4");
      t.is(res.headers["content-encoding"], "custom");
      t.is(await text(res), "body");
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    http.get({ port, method: "HEAD", path: "/content-encoding" }, (res) => {
      t.is(res.headers["content-length"], "4");
      t.is(res.headers["content-encoding"], "custom");
      resolve();
    });
  });

  // Check with `encodeBody: "manual"`
  await new Promise<void>((resolve) => {
    http.get({ port, path: "/encode-body-manual" }, async (res) => {
      t.is(res.headers["content-length"], "4");
      t.is(await text(res), "body");
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    http.get({ port, method: "HEAD", path: "/encode-body-manual" }, (res) => {
      t.is(res.headers["content-length"], "4");
      resolve();
    });
  });
});
test("createRequestListener: logs response", async (t) => {
  const log = new TestLog();
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    (globals) => new globals.Response("body"),
    log
  );
  const port = await listen(t, http.createServer(createRequestListener(mf)));

  let [body] = await request(port);
  t.is(body, "body");
  let logs = log.logsAtLevel(LogLevel.NONE);
  t.is(logs.length, 1);
  t.regex(logs[0], /^GET \/ 200 OK \(\d+\.\d+ms\)$/);

  // Check includes inaccurate CPU time if enabled
  await mf.setOptions({ inaccurateCpu: true });
  log.logs = [];
  [body] = await request(port);
  t.is(body, "body");
  logs = log.logsAtLevel(LogLevel.NONE);
  t.is(logs.length, 1);
  t.regex(logs[0], /^GET \/ 200 OK \(\d+\.\d+ms\) \(CPU: ~\d+\.\d+ms\)$/);
});

test("createServer: handles regular requests", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals, req) => {
    return new globals.Response(`body:${req.url}`);
  });
  const port = await listen(t, await createServer(mf));
  const [body] = await request(port);
  t.is(body, `body:http://localhost:${port}/`);
});
test("createServer: handles web socket upgrades", async (t) => {
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin },
    {},
    async (globals) => {
      // Simulate slow response, WebSocket must not open until worker responds
      await new Promise((resolve) => globals.setTimeout(resolve, 1000));

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
  const [eventTrigger, eventPromise] = triggerPromise<Data>();
  ws.addEventListener("message", (e) => {
    eventTrigger(e.data);
  });
  ws.addEventListener("open", () => {
    ws.send("hello");
  });
  t.is(await eventPromise, "worker:hello");
});
test("createServer: includes headers from web socket upgrade response", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/151
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin },
    {},
    async (globals) => {
      const [client, worker] = Object.values(new globals.WebSocketPair());
      worker.accept();
      return new globals.Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          "Set-Cookie": "key=value",
          Connection: "close", // This header should be ignored
          "SeC-WebSoCKet-aCCePt": ":(", // ...as should this
        },
      });
    }
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`);
  const [trigger, promise] = triggerPromise<http.IncomingMessage>();
  ws.addListener("upgrade", (req) => trigger(req));
  const req = await promise;
  t.is(req.headers.connection, "Upgrade");
  t.not(req.headers["sec-websocket-accept"], undefined);
  t.not(req.headers["sec-websocket-accept"], ":(");
  t.deepEqual(req.headers["set-cookie"], ["key=value"]);
});
test("createServer: handles web socket upgrade response with Sec-WebSocket-Protocol header", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/179
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin },
    {},
    async (globals) => {
      const [client, worker] = Object.values(new globals.WebSocketPair());
      worker.accept();
      worker.addEventListener("message", (e: MessageEvent) => {
        worker.send(`worker:${e.data}`);
      });
      return new globals.Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": "protocol2" },
      });
    }
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`, [
    "protocol1",
    "protocol2",
    "protocol3",
  ]);
  ws.addListener("upgrade", (req) => {
    t.is(req.headers["sec-websocket-protocol"], "protocol2");
  });
  const [eventTrigger, eventPromise] = triggerPromise<Data>();
  ws.addEventListener("message", (e) => eventTrigger(e.data));
  ws.addEventListener("open", () => ws.send("hello"));
  t.is(await eventPromise, "worker:hello");
});
test("createServer: handles web socket upgrade immediately with waitUntil", async (t) => {
  const [waitUntilTrigger, waitUntilPromise] = triggerPromise<void>();
  const mf = useMiniflare(
    { HTTPPlugin, WebSocketPlugin, BindingsPlugin },
    {
      globals: { waitUntilPromise },
      script: `
      addEventListener("fetch", (event) => {
        const [client, worker] = Object.values(new WebSocketPair());
        worker.accept();
        worker.send("worker:1");
        event.waitUntil(waitUntilPromise.then(() => worker.send("worker:2")));
        event.respondWith(new Response(null, { status: 101, webSocket: client }));
      })
      `,
    }
  );
  const port = await listen(t, await createServer(mf));
  const ws = new StandardWebSocket(`ws://localhost:${port}`);

  const [finishTrigger, finishPromise] = triggerPromise<void>();
  let triggeredWaitUntil = false;
  ws.addEventListener("message", (e) => {
    if (!triggeredWaitUntil) {
      // Only release waitUntil once we've received the first message, ensuring
      // upgrade handled before waitUntil resolves
      t.is(e.data, "worker:1");
      waitUntilTrigger();
      triggeredWaitUntil = true;
    } else {
      t.is(e.data, "worker:2");
      finishTrigger();
    }
  });
  await finishPromise;
});
test("createServer: dispatches close events on client and server close", async (t) => {
  const [clientCloseTrigger, clientClosePromise] = triggerPromise<void>();
  const [serverCloseTrigger, serverClosePromise] = triggerPromise<void>();
  const counts = {
    clientCloses: 0,
    serverCloses: 0,
    clientCloseTrigger,
    serverCloseTrigger,
  };
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin, BindingsPlugin },
    { globals: { t, counts } },
    async (globals, req) => {
      const url = new globals.URL(req.url);
      if (url.pathname.startsWith("/client")) {
        const [client, worker] = Object.values(new globals.WebSocketPair());
        worker.accept();
        worker.addEventListener("close", (e: CloseEvent) => {
          globals.t.is(e.code, 3001);
          globals.t.is(e.reason, "Client Close");
          if (url.pathname === "/client/event-listener") {
            worker.close(3002, "Server Event Listener Close");
          }

          globals.counts.clientCloses++;
          if (globals.counts.clientCloses === 2) {
            globals.counts.clientCloseTrigger();
          }
        });
        return new globals.Response(null, { status: 101, webSocket: client });
      } else if (url.pathname === "/server") {
        const [client, worker] = Object.values(new globals.WebSocketPair());
        worker.accept();
        worker.addEventListener("message", (e: MessageEvent) => {
          if (e.data === "close") worker.close(3003, "Server Close");
        });
        worker.addEventListener("close", (e: CloseEvent) => {
          globals.t.is(e.code, 3003);
          globals.t.is(e.reason, "Server Close");

          globals.counts.serverCloses++;
          if (globals.counts.serverCloses === 2) {
            globals.counts.serverCloseTrigger();
          }
        });
        return new globals.Response(null, { status: 101, webSocket: client });
      }
      return new globals.Response(null, { status: 404 });
    }
  );
  const port = await listen(t, await createServer(mf));

  // Check client-side close
  async function clientSideClose(closeInEventListener: boolean) {
    const path = closeInEventListener ? "/client/event-listener" : "/client";
    const ws = new StandardWebSocket(`ws://localhost:${port}${path}`);
    ws.addEventListener("open", () => {
      ws.close(3001, "Client Close");
    });
    const [code, reason] = await once(ws, "close");
    t.is(code, 3001);
    t.is(reason.toString(), "Client Close");
  }
  await clientSideClose(false);
  await clientSideClose(true);
  await clientClosePromise;

  // Check server-side close
  async function serverSideClose(closeInEventListener: boolean) {
    const ws = new StandardWebSocket(`ws://localhost:${port}/server`);
    ws.addEventListener("open", () => {
      ws.send("close");
    });
    const [code, reason] = await once(ws, "close");
    if (closeInEventListener) ws.close(3004, "Client Event Listener Close");
    t.is(code, 3003);
    t.is(reason.toString(), "Server Close");
  }
  await serverSideClose(false);
  await serverSideClose(true);
  await serverClosePromise;
});
test("createServer: expects status 101 and web socket response for successful upgrades", async (t) => {
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
  const [closeTrigger, closePromise] = triggerPromise<WebSocketCloseEvent>();
  const [errorTrigger, errorPromise] = triggerPromise<WebSocketErrorEvent>();
  ws.addEventListener("close", closeTrigger);
  ws.addEventListener("error", errorTrigger);
  const closeEvent = await closePromise;
  const errorEvent = await errorPromise;

  t.deepEqual(log.logsAtLevel(LogLevel.ERROR), [
    "TypeError: Web Socket request did not return status 101 Switching Protocols response with Web Socket",
  ]);
  t.is(closeEvent.code, 1006);
  t.is(errorEvent.message, "Unexpected server response: 500");
});
test("createServer: allows non-101 status codes for unsuccessful web socket upgrades", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/174
  const log = new TestLog();
  log.error = (message) => log.logWithLevel(LogLevel.ERROR, message.toString());
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    {},
    (globals) => new globals.Response("unauthorized", { status: 401 }),
    log
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`);
  const [closeTrigger, closePromise] = triggerPromise<WebSocketCloseEvent>();
  const [errorTrigger, errorPromise] = triggerPromise<WebSocketErrorEvent>();
  ws.addEventListener("close", closeTrigger);
  ws.addEventListener("error", errorTrigger);
  const closeEvent = await closePromise;
  const errorEvent = await errorPromise;

  t.deepEqual(log.logsAtLevel(LogLevel.ERROR), []);
  t.is(closeEvent.code, 1006);
  t.is(errorEvent.message, "Unexpected server response: 401");
});
test("createServer: creates new request context for each web socket message", async (t) => {
  const mf = useMiniflare(
    {
      HTTPPlugin,
      WebSocketPlugin,
      BindingsPlugin,
      CachePlugin,
      DurableObjectsPlugin,
    },
    {
      globals: {
        assertSubrequests(expected: number) {
          t.is(getRequestContext()?.externalSubrequests, expected);
        },
      },
      durableObjects: { TEST_OBJECT: "TestObject" },
      modules: true,
      script: `
      export class TestObject {
        async fetch() {
          assertSubrequests(0);
          await caches.default.match("http://localhost/");
          assertSubrequests(1);
    
          const [client, worker] = Object.values(new WebSocketPair());
          worker.accept();
          worker.addEventListener("message", async (e) => {
            assertSubrequests(0);
            const n = parseInt(e.data);
            try {
              await Promise.all(
                Array.from(Array(n)).map(() => caches.default.match("http://localhost/"))
              );
              worker.send(\`success:\${n}\`);
            } catch (e) {
              worker.send(\`error:\${e.message}\`);
            }
          });
          return new Response(null, { status: 101, webSocket: client });
        }
      }
      export default {
        async fetch(request, env) {
          const id = env.TEST_OBJECT.newUniqueId();
          const stub = env.TEST_OBJECT.get(id);
          return stub.fetch(request);
        }
      }
      `,
    }
  );
  const port = await listen(t, await createServer(mf));

  const ws = new StandardWebSocket(`ws://localhost:${port}`);
  const { readable, writable } = new TransformStream<WebSocketMessageEvent>();
  const reader = readable.getReader();
  const writer = writable.getWriter();
  ws.addEventListener("message", (e) => writer.write(e));
  await new Promise((resolve) => ws.addEventListener("open", resolve));

  ws.send("3");
  t.is((await reader.read()).value?.data, "success:3");
  ws.send("51");
  t.regex((await reader.read()).value?.data, /^error:Too many subrequests/);
});
test("createServer: notifies connected live reload clients on reload", async (t) => {
  const mf = useMiniflareWithHandler({ HTTPPlugin }, {}, (globals) => {
    // Connecting to live reload server shouldn't make any worker requests
    t.fail();
    return new globals.Response(null);
  });
  await mf.getPlugins();

  const port = await listen(t, await createServer(mf));
  const ws = new StandardWebSocket(`ws://localhost:${port}/cdn-cgi/mf/reload`);
  const [openTrigger, openPromise] = triggerPromise<WebSocketEvent>();
  ws.addEventListener("open", openTrigger);
  let receivedClose = false;
  const [closeTrigger, closePromise] = triggerPromise<void>();
  ws.addEventListener("close", (event) => {
    t.is(event.code, 1012 /* Service Restart */);
    receivedClose = true;
    closeTrigger();
  });
  await openPromise;

  await setTimeout();
  t.false(receivedClose);
  await mf.reload();
  await closePromise;
  t.true(receivedClose);
});
test("createServer: handles https requests", async (t) => {
  const tmp = await useTmp(t);
  const mf = useMiniflareWithHandler(
    { HTTPPlugin },
    { https: tmp },
    (globals, req) => {
      return new globals.Response(`body:${req.url}`);
    }
  );
  const port = await listen(t, await createServer(mf));
  const [body] = await request(port, "", {}, true);
  t.is(body, `body:https://localhost:${port}/`);
});
test("createServer: proxies redirect responses", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/133
  const upstream = await useServer(t, async (req, res) => {
    const { pathname } = new URL(req.url ?? "", "http://localhost");
    if (pathname === "/redirect") {
      t.is(await text(req), "body");
      res.writeHead(302, { Location: `/`, "Set-Cookie": `key=value` });
    } else {
      t.fail();
    }
    res.end();
  });
  const mf = useMiniflareWithHandler(
    { HTTPPlugin, WebSocketPlugin },
    { upstream: upstream.http.toString() },
    (globals, req) => globals.fetch(req)
  );
  const port = await listen(t, await createServer(mf));

  const res = await new Promise<http.IncomingMessage>((resolve) =>
    http
      .request({ port, method: "POST", path: "/redirect" }, resolve)
      .end("body")
  );
  t.is(res.statusCode, 302);
  t.is(res.headers.location, `/`);
  t.deepEqual(res.headers["set-cookie"], ["key=value"]);
});
