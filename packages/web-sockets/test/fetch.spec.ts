import assert from "assert";
import { Blob } from "buffer";
import http from "http";
import { AddressInfo } from "net";
import { TransformStream } from "stream/web";
import { URLSearchParams } from "url";
import { CachePlugin } from "@miniflare/cache";
import { BindingsPlugin, createCompatFetch } from "@miniflare/core";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import {
  Compatibility,
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  LogLevel,
  RequestContext,
  getRequestContext,
} from "@miniflare/shared";
import {
  TestLog,
  noop,
  triggerPromise,
  useMiniflare,
  useServer,
} from "@miniflare/shared-test";
import {
  CloseEvent,
  MessageEvent,
  WebSocketPlugin,
  upgradingFetch,
} from "@miniflare/web-sockets";
import test from "ava";
import { FormData } from "undici";
import StandardWebSocket, {
  MessageEvent as WebSocketMessageEvent,
  WebSocketServer,
} from "ws";

test("upgradingFetch: performs regular http request", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const res = await upgradingFetch(upstream);
  t.is(await res.text(), "upstream");
});
test("upgradingFetch: performs http request with form data", async (t) => {
  const echoUpstream = (
    await useServer(t, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.end(body));
    })
  ).http;
  const body = new FormData();
  body.append("a", "1");
  body.append("b", new URLSearchParams({ x: "1", y: "2", z: "3" }));
  body.append("c", new Blob(["abc"]), "file.txt");
  const res = await upgradingFetch(echoUpstream, { method: "POST", body });
  const text = await res.text();
  t.regex(text, /Content-Disposition: form-data; name="a"\r\n\r\n1/);
  t.regex(text, /Content-Disposition: form-data; name="b"\r\n\r\nx=1&y=2&z=3/);
  t.regex(
    text,
    /Content-Disposition: form-data; name="c"; filename="file.txt"\r\nContent-Type: application\/octet-stream\r\n\r\nabc/
  );
});
test("upgradingFetch: performs web socket upgrade", async (t) => {
  const server = await useServer(t, noop, (ws, req) => {
    ws.send("hello client");
    ws.send(req.headers["user-agent"]);
    ws.addEventListener("message", ({ data }) => ws.send(data));
  });
  const res = await upgradingFetch(server.http, {
    headers: { upgrade: "websocket", "user-agent": "Test" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: (string | ArrayBuffer)[] = [];
  webSocket.addEventListener("message", (e) => {
    messages.push(e.data);
    if (e.data === "hello server") eventTrigger();
  });
  webSocket.accept();
  webSocket.send("hello server");

  await eventPromise;
  t.deepEqual(messages, ["hello client", "Test", "hello server"]);
});
test("upgradingFetch: performs web socket upgrade with Sec-WebSocket-Protocol header", async (t) => {
  const server = await useServer(t, noop, (ws, req) => {
    ws.send(req.headers["sec-websocket-protocol"]);
  });
  const res = await upgradingFetch(server.http, {
    headers: {
      upgrade: "websocket",
      "Sec-WebSocket-Protocol": "protocol1, proto2,p3",
    },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  const [eventTrigger, eventPromise] = triggerPromise<MessageEvent>();
  webSocket.addEventListener("message", eventTrigger);
  webSocket.accept();

  const event = await eventPromise;
  t.is(event.data, "protocol1,proto2,p3");
});
test("upgradingFetch: includes headers from web socket upgrade response", async (t) => {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.send("hello");
    ws.close();
  });
  wss.on("headers", (headers) => {
    headers.push("Set-Cookie: key=value");
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      t.teardown(() => server.close());
      resolve((server.address() as AddressInfo).port);
    });
  });
  const res = await upgradingFetch(`http://localhost:${port}`, {
    headers: { upgrade: "websocket" },
  });
  t.not(res.webSocket, undefined);
  t.is(res.headers.get("set-cookie"), "key=value");
});
test("upgradingFetch: dispatches close events on client and server close", async (t) => {
  let clientCloses = 0;
  let serverCloses = 0;
  const [clientCloseTrigger, clientClosePromise] = triggerPromise<void>();
  const [serverCloseTrigger, serverClosePromise] = triggerPromise<void>();

  const server = await useServer(t, noop, (ws, req) => {
    if (req.url?.startsWith("/client")) {
      ws.on("close", (code, reason) => {
        t.is(code, 3001);
        t.is(reason.toString(), "Client Close");
        if (req.url === "/client/event-listener") {
          ws.close(3002, "Server Event Listener Close");
        }

        clientCloses++;
        if (clientCloses === 2) clientCloseTrigger();
      });
    } else if (req.url === "/server") {
      ws.on("message", (data) => {
        if (data.toString() === "close") ws.close(3003, "Server Close");
      });
      ws.on("close", (code, reason) => {
        t.is(code, 3003);
        t.is(reason.toString(), "Server Close");

        serverCloses++;
        if (serverCloses === 2) serverCloseTrigger();
      });
    }
  });

  // Check client-side close
  async function clientSideClose(closeInEventListener: boolean) {
    const path = closeInEventListener ? "/client/event-listener" : "/client";
    const res = await upgradingFetch(new URL(path, server.http), {
      headers: { upgrade: "websocket" },
    });
    const webSocket = res.webSocket;
    assert(webSocket);
    const [closeEventTrigger, closeEventPromise] = triggerPromise<CloseEvent>();
    webSocket.addEventListener("close", closeEventTrigger);
    webSocket.accept();
    webSocket.close(3001, "Client Close");
    const closeEvent = await closeEventPromise;
    t.is(closeEvent.code, 3001);
    t.is(closeEvent.reason, "Client Close");
  }
  await clientSideClose(false);
  await clientSideClose(true);
  await clientClosePromise;

  // Check server-side close
  async function serverSideClose(closeInEventListener: boolean) {
    const res = await upgradingFetch(new URL("/server", server.http), {
      headers: { upgrade: "websocket" },
    });
    const webSocket = res.webSocket;
    assert(webSocket);
    const [closeEventTrigger, closeEventPromise] = triggerPromise<CloseEvent>();
    webSocket.addEventListener("close", (event) => {
      if (closeInEventListener) {
        webSocket.close(3004, "Client Event Listener Close");
      }
      closeEventTrigger(event);
    });
    webSocket.accept();
    webSocket.send("close");
    const closeEvent = await closeEventPromise;
    t.is(closeEvent.code, 3003);
    t.is(closeEvent.reason, "Server Close");
  }
  await serverSideClose(false);
  await serverSideClose(true);
  await serverClosePromise;
});
test("upgradingFetch: throws on ws(s) protocols", async (t) => {
  await t.throwsAsync(
    upgradingFetch("ws://localhost/", {
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message:
        "Fetch API cannot load: ws://localhost/.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.",
    }
  );
  await t.throwsAsync(
    upgradingFetch("wss://localhost/", {
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message:
        "Fetch API cannot load: wss://localhost/.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.",
    }
  );
});
test("upgradingFetch: allows ws protocol with createCompatFetch", async (t) => {
  const log = new TestLog();
  const compat = new Compatibility();
  const fetch = createCompatFetch(
    { log, compat, globalAsyncIO: true },
    upgradingFetch
  );
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", ({ data }) => ws.send(data));
  });
  // Should implicitly treat this as http
  const res = await fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);

  // Check warning logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 1);
  t.regex(
    warnings[0],
    /URLs passed to fetch\(\) must begin with either 'http:' or 'https:', not 'ws:'.+fetch\(\) treats WebSockets as a special kind of HTTP request/
  );

  const [eventTrigger, eventPromise] = triggerPromise<MessageEvent>();
  webSocket.addEventListener("message", eventTrigger);
  webSocket.accept();
  webSocket.send("hello");
  t.is((await eventPromise).data, "hello");
});
test("upgradingFetch: requires GET for web socket upgrade", async (t) => {
  const server = await useServer(
    t,
    (req, res) => {
      t.is(req.method, "POST");
      res.end("http response");
    },
    () => t.fail()
  );
  await t.throwsAsync(
    upgradingFetch(server.http, {
      method: "POST",
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message: "fetch failed",
    }
  );
});
test("upgradeFetch: throws catchable error on connection failure", async (t) => {
  await t.throwsAsync(
    upgradingFetch("http://127.0.0.1:0", { headers: { upgrade: "websocket" } })
  );
});
test("upgradingFetch: increments subrequest count", async (t) => {
  const server = await useServer(
    t,
    (req, res) => res.end(),
    (ws) => ws.close()
  );
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  let res = await ctx.runWith(() =>
    upgradingFetch(server.http, { headers: { upgrade: "websocket" } })
  );
  t.not(res.webSocket, undefined);
  t.is(ctx.externalSubrequests, 1);
  res = await ctx.runWith(() => upgradingFetch(server.http));
  t.is(res.webSocket, undefined);
  t.is(ctx.externalSubrequests, 2);
});
test("upgradingFetch: creates new request context for each web socket message", async (t) => {
  const [trigger, promise] = triggerPromise<StandardWebSocket>();
  const server = await useServer(
    t,
    () => t.fail(),
    (ws) => trigger(ws)
  );
  const mf = useMiniflare(
    { WebSocketPlugin, BindingsPlugin, CachePlugin, DurableObjectsPlugin },
    {
      globals: {
        WS_URL: server.ws,
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
          
          const res = await fetch(WS_URL, {
            headers: { "upgrade": "websocket" },
          });
          assertSubrequests(2);
          res.webSocket.accept();
          res.webSocket.addEventListener("message", async (e) => {
            assertSubrequests(0);
            const n = parseInt(e.data);
            try {
              await Promise.all(
                Array.from(Array(n)).map(() => caches.default.match("http://localhost/"))
              );
              res.webSocket.send(\`success:\${n}\`);
            } catch (e) {
              res.webSocket.send(\`error:\${e.message}\`);
            }
          });
          return new Response();
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
  await mf.dispatchFetch("http://localhost/");
  const ws = await promise;
  const { readable, writable } = new TransformStream<WebSocketMessageEvent>();
  const reader = readable.getReader();
  const writer = writable.getWriter();
  ws.addEventListener("message", (e) => writer.write(e));

  ws.send("3");
  t.is((await reader.read()).value?.data, "success:3");
  ws.send("51");
  t.regex((await reader.read()).value?.data, /^error:Too many subrequests/);
});
