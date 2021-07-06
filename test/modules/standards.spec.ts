import assert from "assert";
import { Request } from "@mrbbot/node-fetch";
import test from "ava";
import FormData from "formdata-node";
import { NoOpLog } from "../../src";
import {
  StandardsModule,
  TextEncoder,
  atob,
  btoa,
  crypto,
} from "../../src/modules/standards";
import { noop, runInWorker, triggerPromise, useServer } from "../helpers";

test("atob: decodes base64 string", (t) => {
  t.is(atob("dGVzdA=="), "test");
});

test("btoa: encodes base64 string", (t) => {
  t.is(btoa("test"), "dGVzdA==");
});

test("crypto: computes md5 digest", async (t) => {
  const digest = await crypto.subtle.digest(
    "md5",
    new TextEncoder().encode("test")
  );
  t.is(Buffer.from(digest).toString("hex"), "098f6bcd4621d373cade4e832627b4f6");
});

test("crypto: computes other digest", async (t) => {
  const digest = await crypto.subtle.digest(
    "sha-1",
    new TextEncoder().encode("test")
  );
  t.is(
    Buffer.from(digest).toString("hex"),
    "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
  );
});

test("fetch: performs regular http request", async (t) => {
  const module = new StandardsModule(new NoOpLog());
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const res = await module.fetch(upstream);
  t.is(await res.text(), "upstream");
});
test("fetch: performs http request with form data", async (t) => {
  const module = new StandardsModule(new NoOpLog());
  const upstream = (
    await useServer(t, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.end(body));
    })
  ).http;
  const body = new FormData();
  body.append("a", "1");
  body.append("b", new URLSearchParams({ x: "1", y: "2", z: "3" }));
  const res = await module.fetch(upstream, { method: "POST", body });
  const text = await res.text();
  t.regex(text, /Content-Disposition: form-data; name="a"\r\n\r\n1/);
  t.regex(text, /Content-Disposition: form-data; name="b"\r\n\r\nx=1&y=2&z=3/);
});
test("fetch: performs web socket upgrade", async (t) => {
  const module = new StandardsModule(new NoOpLog());
  const server = await useServer(t, noop, (ws, req) => {
    ws.send("hello client");
    ws.send(req.headers["user-agent"]);
    ws.addEventListener("message", ({ data }) => ws.send(data));
  });
  const res = await module.fetch(server.ws, {
    headers: { upgrade: "websocket", "user-agent": "Test" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: string[] = [];
  webSocket.addEventListener("message", (e) => {
    messages.push(e.data);
    if (e.data === "hello server") eventTrigger();
  });
  webSocket.accept();
  webSocket.send("hello server");

  await eventPromise;
  t.deepEqual(messages, ["hello client", "Test", "hello server"]);
});
test("resetWebSockets: closes all web sockets", async (t) => {
  const module = new StandardsModule(new NoOpLog());
  const [eventTrigger, eventPromise] = triggerPromise<{
    code: number;
    reason: string;
  }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventTrigger);
  });
  const res = await module.fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  webSocket.accept();

  module.resetWebSockets();
  const event = await eventPromise;
  t.is(event.code, 1012);
  t.is(event.reason, "Service Restart");
});
test("resetWebSockets: closes already closed web sockets", async (t) => {
  const module = new StandardsModule(new NoOpLog());
  const [eventTrigger, eventPromise] = triggerPromise<{
    code: number;
    reason: string;
  }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventTrigger);
  });
  const res = await module.fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  webSocket.accept();
  webSocket.close(1000, "Test Closure");

  module.resetWebSockets();
  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});

test("buildSandbox: includes web standards", (t) => {
  const module = new StandardsModule(new NoOpLog());
  const sandbox = module.buildSandbox();

  t.true(typeof sandbox.console === "object");

  t.true(typeof sandbox.setTimeout === "function");
  t.true(typeof sandbox.setInterval === "function");
  t.true(typeof sandbox.clearTimeout === "function");
  t.true(typeof sandbox.clearInterval === "function");

  t.true(typeof sandbox.atob === "function");
  t.true(typeof sandbox.btoa === "function");

  t.true(typeof sandbox.crypto === "object");
  t.true(typeof sandbox.TextDecoder === "function");
  t.true(typeof sandbox.TextEncoder === "function");

  t.true(typeof sandbox.fetch === "function");
  t.true(typeof sandbox.Headers === "function");
  t.true(typeof sandbox.Request === "function");
  t.true(typeof sandbox.Response === "function");
  t.true(typeof sandbox.FormData === "function");
  t.true(typeof sandbox.URL === "function");
  t.true(typeof sandbox.URLSearchParams === "function");

  t.true(typeof sandbox.HTMLRewriter === "function");

  t.true(typeof sandbox.ByteLengthQueuingStrategy === "function");
  t.true(typeof sandbox.CountQueuingStrategy === "function");
  t.true(typeof sandbox.ReadableByteStreamController === "function");
  t.true(typeof sandbox.ReadableStream === "function");
  t.true(typeof sandbox.ReadableStreamBYOBReader === "function");
  t.true(typeof sandbox.ReadableStreamBYOBRequest === "function");
  t.true(typeof sandbox.ReadableStreamDefaultController === "function");
  t.true(typeof sandbox.ReadableStreamDefaultReader === "function");
  t.true(typeof sandbox.TransformStream === "function");
  t.true(typeof sandbox.TransformStreamDefaultController === "function");
  t.true(typeof sandbox.WritableStream === "function");
  t.true(typeof sandbox.WritableStreamDefaultController === "function");
  t.true(typeof sandbox.WritableStreamDefaultWriter === "function");

  t.true(typeof sandbox.ArrayBuffer === "function");
  t.true(typeof sandbox.Atomics === "object");
  t.true(typeof sandbox.BigInt64Array === "function");
  t.true(typeof sandbox.BigUint64Array === "function");
  t.true(typeof sandbox.DataView === "function");
  t.true(typeof sandbox.Date === "function");
  t.true(typeof sandbox.Float32Array === "function");
  t.true(typeof sandbox.Float64Array === "function");
  t.true(typeof sandbox.Int8Array === "function");
  t.true(typeof sandbox.Int16Array === "function");
  t.true(typeof sandbox.Int32Array === "function");
  t.true(typeof sandbox.Map === "function");
  t.true(typeof sandbox.Set === "function");
  t.true(typeof sandbox.SharedArrayBuffer === "function");
  t.true(typeof sandbox.Uint8Array === "function");
  t.true(typeof sandbox.Uint8ClampedArray === "function");
  t.true(typeof sandbox.Uint16Array === "function");
  t.true(typeof sandbox.Uint32Array === "function");
  t.true(typeof sandbox.WeakMap === "function");
  t.true(typeof sandbox.WeakSet === "function");
  t.true(typeof sandbox.WebAssembly === "object");
});

test("buildSandbox: includes omitted web standards", async (t) => {
  const result = await runInWorker({}, () => {
    // noinspection SuspiciousTypeOfGuard
    return {
      Array: typeof Array === "function",
      Boolean: typeof Boolean === "function",
      Function: typeof Function === "function",
      Error: typeof Error === "function",
      EvalError: typeof EvalError === "function",
      Math: typeof Math === "object",
      NaN: typeof NaN === "number",
      Number: typeof Number === "function",
      BigInt: typeof BigInt === "function",
      Object: typeof Object === "function",
      Promise: typeof Promise === "function",
      Proxy: typeof Proxy === "function",
      RangeError: typeof RangeError === "function",
      ReferenceError: typeof ReferenceError === "function",
      Reflect: typeof Reflect === "object",
      RegExp: typeof RegExp === "function",
      String: typeof String === "function",
      Symbol: typeof Symbol === "function",
      SyntaxError: typeof SyntaxError === "function",
      TypeError: typeof TypeError === "function",
      URIError: typeof URIError === "function",
      Intl: typeof Intl === "object",
      JSON: typeof JSON === "object",
    };
  });
  for (const [key, value] of Object.entries(result)) {
    t.true(value, key);
  }
});

test("buildSandbox: can use instanceof with literals", async (t) => {
  const result = await runInWorker({}, () => {
    return {
      Array: [] instanceof Array,
      Object: {} instanceof Object,
      Function: (() => {}) instanceof Function,
      RegExp: /abc/ instanceof RegExp,
      Promise: (async () => {})() instanceof Promise,
      JSONArray: JSON.parse("[]") instanceof Array,
      JSONObject: JSON.parse("{}") instanceof Object,
    };
  });
  for (const [key, value] of Object.entries(result)) {
    t.true(value, key);
  }
});
