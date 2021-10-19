import assert from "assert";
import { text } from "stream/consumers";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";
import {
  Headers,
  IncomingRequestCfProperties,
  InputGatedBody,
  Request,
  Response,
  inputGatedFetch,
  logResponse,
  withImmutableHeaders,
  withInputGating,
  withWaitUntil,
} from "@miniflare/core";
import { InputGate, LogLevel } from "@miniflare/shared";
import {
  TestLog,
  triggerPromise,
  useServer,
  waitsForInputGate,
} from "@miniflare/shared-test";
import { WebSocketPair } from "@miniflare/web-sockets";
import test, { Macro } from "ava";
import {
  Headers as BaseHeaders,
  Request as BaseRequest,
  Response as BaseResponse,
  BodyMixin,
} from "undici";

// @ts-expect-error filling out all properties is annoying
const cf: IncomingRequestCfProperties = { country: "GB" };

test('Headers: getAll: throws if key not "Set-Cookie"', (t) => {
  const headers = new Headers();
  t.throws(() => headers.getAll("set-biscuit"), {
    instanceOf: TypeError,
    message: 'getAll() can only be used with the header name "Set-Cookie".',
  });
});
test("Headers: getAll: returns empty array if no headers", (t) => {
  const headers = new Headers();
  t.deepEqual(headers.getAll("Set-Cookie"), []);
});
test("Headers: getAll: returns separated Set-Cookie values", (t) => {
  const headers = new Headers();
  const cookie1 = "key1=value1; Expires=Mon, 18 Oct 2021 17:45:00 GMT";
  const cookie2 = "key2=value2";
  const cookie3 = "key3=value3; Max-Age=3600";
  headers.append("Set-Cookie", cookie1);
  headers.append("Set-Cookie", cookie2);
  headers.append("Set-Cookie", cookie3);
  t.is(headers.get("set-Cookie"), [cookie1, cookie2, cookie3].join(", "));
  t.deepEqual(headers.getAll("set-CoOkiE"), [cookie1, cookie2, cookie3]);
});

// These tests also implicitly test withInputGating
test("InputGatedBody: body isn't input gated by default", async (t) => {
  const inputGate = new InputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();
  await inputGate.runWith(async () => {
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    const body = new InputGatedBody(new BaseResponse("body")).body;
    assert(body);
    t.is(await text(body), "body");
  });
  openTrigger();
});
test("InputGatedBody: body returns null with null body", (t) => {
  const body = withInputGating(new InputGatedBody(new BaseResponse(null)));
  t.is(body.body, null);
});
test("InputGatedBody: same body instance is always returned", (t) => {
  const body = withInputGating(new InputGatedBody(new BaseResponse("body")));
  t.is(body.body, body.body);
});
test("InputGatedBody: body isn't locked until read from", async (t) => {
  const res = withInputGating(new Response("body"));
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof InputGatedBody);
  // noinspection SuspiciousTypeOfGuard
  assert(res.body instanceof ReadableStream);

  // Access property that doesn't read any data
  t.false(res.body.locked);
  // Check we can still clone the body
  const clone = res.clone();
  t.is(await clone.text(), "body");
});
const inputGatedBodyMacro: Macro<[(body: ReadableStream) => Promise<any>]> =
  async (t, closure) => {
    const res = withInputGating(new InputGatedBody(new BaseResponse("body")));
    // @ts-expect-error res.body is a ReadableStream
    const body: ReadableStream = res.body;
    await waitsForInputGate(t, () => closure(body));
  };
inputGatedBodyMacro.title = (providedTitle) =>
  `InputGatedBody: body.${providedTitle}() applies input gating`;
test("getReader", inputGatedBodyMacro, (body) => body.getReader().read());
test("pipeTrough", inputGatedBodyMacro, (body) =>
  body.pipeThrough(new TransformStream()).getReader().read()
);
test("pipeTo", inputGatedBodyMacro, (body) =>
  body.pipeTo(new WritableStream())
);
test("tee", inputGatedBodyMacro, (body) => body.tee()[0].getReader().read());
test("values", inputGatedBodyMacro, (body) => body.values().next());
test("[Symbol.asyncIterator]", inputGatedBodyMacro, (body) =>
  body[Symbol.asyncIterator]().next()
);
const inputGatedConsumerMacro: Macro<
  [key: Exclude<keyof BodyMixin, "body" | "bodyUsed">, res?: BaseResponse]
> = async (t, key, res = new BaseResponse('{"key": "value"}')) => {
  // Check result is not input gated by default
  const inputGate = new InputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();
  await inputGate.runWith(async () => {
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    const body = new InputGatedBody(res.clone());
    t.not(await body?.[key](), undefined);
  });
  openTrigger();

  // Check input gating can be enabled
  await waitsForInputGate(t, async () => {
    const body = withInputGating(new InputGatedBody(res));
    await body?.[key]();
  });
};
inputGatedConsumerMacro.title = (providedTitle, key) =>
  `InputGatedBody: ${key}() applies input gating`;
test(inputGatedConsumerMacro, "arrayBuffer");
test(inputGatedConsumerMacro, "blob");
test(
  inputGatedConsumerMacro,
  "formData",
  new BaseResponse("key=value", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })
);
test(inputGatedConsumerMacro, "json");
test(inputGatedConsumerMacro, "text");
test("InputGatedBody: reuses custom headers instance", (t) => {
  const headers = new BaseHeaders();
  headers.append("Set-Cookie", "key1=value1");
  headers.append("Set-Cookie", "key2=value2");
  const body = new InputGatedBody(new BaseResponse("body", { headers }));
  const customHeaders = body.headers;
  t.not(headers, customHeaders);
  t.is(body.headers, customHeaders);
  t.deepEqual(customHeaders.getAll("Set-Cookie"), [
    "key1=value1",
    "key2=value2",
  ]);
});

test("Request: constructing from BaseRequest doesn't create new BaseRequest unless required", (t) => {
  // Check properties of Request are same as BaseRequest if not RequestInit passed
  const controller = new AbortController();
  const base = new BaseRequest("http://localhost", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "text/html" },
    body: "<p>test</p>",
    redirect: "follow",
    integrity: "sha256-BpfBw7ivV8q2jLiT13fxDYAe2tJllusRSZ273h2nFSE=",
    signal: controller.signal,
  });
  let req = new Request(base);
  // Wouldn't be the same instance if cloned
  // @ts-expect-error our bodies are typed ReadableStream
  t.is(req.body, base.body);

  t.is(req.cache, base.cache);
  t.is(req.credentials, base.credentials);
  t.is(req.destination, base.destination);
  t.is(req.integrity, base.integrity);
  t.is(req.method, base.method);
  t.is(req.cache, base.cache);
  t.is(req.mode, base.mode);
  t.is(req.redirect, base.redirect);
  t.is(req.cache, base.cache);
  t.is(req.referrerPolicy, base.referrerPolicy);
  t.is(req.url, base.url);
  t.is(req.keepalive, base.keepalive);
  t.is(req.signal, base.signal);

  // Check new BaseRequest created if RequestInit passed
  req = new Request(base, {
    method: "PATCH",
  });
  // Should be different as new instance created
  // @ts-expect-error our bodies are typed ReadableStream
  t.not(req.body, base.body);
  t.is(req.method, "PATCH");
});
test("Request: can construct new Request from existing Request", async (t) => {
  const req = new Request("http://localhost", {
    method: "POST",
    body: "body",
    cf,
  });
  const req2 = new Request(req);
  // Should be different as new instance created
  t.not(req2.headers, req.headers);
  t.not(req2.body, req.body);
  t.not(req2.cf, req.cf);

  t.is(req2.method, "POST");
  t.is(await req2.text(), "body");
  t.deepEqual(req2.cf, cf);
});
test("Request: supports non-standard properties", (t) => {
  const req = new Request("http://localhost", {
    method: "POST",
    cf,
  });
  t.is(req.method, "POST");
  t.deepEqual(req.cf, cf);
  // Check cf has been cloned
  t.not(req.cf, cf);
});
test("Request: clones non-standard properties", (t) => {
  const req = new Request("http://localhost", {
    method: "POST",
    cf,
  });
  const req2 = req.clone();
  t.is(req2.method, "POST");
  t.deepEqual(req2.cf, cf);
  t.not(req2.cf, req.cf);

  // Check prototype correct and clone still clones non-standard properties
  t.is(Object.getPrototypeOf(req2), Request.prototype);
  const req3 = req2.clone();
  t.is(req3.method, "POST");
  t.deepEqual(req3.cf, cf);
  t.not(req3.cf, req2.cf);
});
test("Request: can be input gated", async (t) => {
  const req = withInputGating(
    new Request("http://localhost", { method: "POST", body: "body" })
  );
  // noinspection SuspiciousTypeOfGuard
  t.true(req instanceof InputGatedBody);
  await waitsForInputGate(t, () => req.text());
});
test("Request: clone retains input gated option", async (t) => {
  const req = withInputGating(
    new Request("http://localhost", { method: "POST", body: "body" })
  );
  const clone = req.clone();
  await waitsForInputGate(t, () => clone.text());
});

test("withImmutableHeaders: makes Request's headers immutable", (t) => {
  const req = new Request("http://localhost");
  req.headers.set("X-Key", "value");
  t.is(withImmutableHeaders(req), req);
  t.throws(() => req.headers.set("X-Key", "new"), {
    instanceOf: TypeError,
    message: "immutable",
  });
  t.is(req.headers.get("X-Key"), "value");
});

test("Response.redirect: creates redirect response", (t) => {
  const res = Response.redirect("http://localhost/", 302);
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Response);
  t.is(res.headers.get("Location"), "http://localhost/");
});
test("Response: constructing from BaseResponse doesn't create new BaseResponse unless required", async (t) => {
  const base = new BaseResponse("<p>test</p>", {
    status: 404,
    statusText: "Not Found",
    headers: { "Content-Type": "text/html" },
  });
  let res = new Response(base.body, base);
  // Wouldn't be the same if cloned
  // @ts-expect-error our bodies are typed ReadableStream
  t.is(res.body, base.body);

  t.is(res.status, base.status);
  t.is(res.ok, base.ok);
  t.is(res.statusText, base.statusText);
  t.is(res.type, base.type);
  t.is(res.url, base.url);
  t.is(res.redirected, base.redirected);

  // Check new BaseResponse created if different body passed
  res = new Response("<p>new</p>", base);
  // Should be different as new instance created
  // @ts-expect-error our bodies are typed ReadableStream
  t.not(res.body, base.body);
  t.is(await res.text(), "<p>new</p>");
});
test("Response: can construct new Response from existing Response", async (t) => {
  const res = new Response("<p>test</p>", {
    status: 404,
    headers: { "Content-Type": "text/html" },
  });
  const res2 = new Response(res.body, res);
  // Should be different as new instance created
  t.not(res2.headers, res.headers);

  t.is(res2.status, 404);
  t.is(await res2.text(), "<p>test</p>");
});
test("Response: supports non-standard properties", (t) => {
  const pair = new WebSocketPair();
  const res = new Response(null, {
    status: 101,
    webSocket: pair["0"],
    headers: { "X-Key": "value" },
  });
  t.is(res.status, 101);
  t.is(res.webSocket, pair[0]);
  t.is(res.headers.get("X-Key"), "value");
});
test("Response: requires status 101 for WebSocket response", (t) => {
  const pair = new WebSocketPair();
  t.throws(() => new Response(null, { webSocket: pair["0"] }), {
    instanceOf: RangeError,
    message: "Responses with a WebSocket must have status code 101.",
  });
});
test("Response: only allows status 101 for WebSocket response", (t) => {
  t.throws(() => new Response(null, { status: 101 }), {
    instanceOf: RangeError,
    message:
      "Failed to construct 'Response': The status provided (101) is outside the range [200, 599].",
  });
});
test("Response: clones non-standard properties", async (t) => {
  const res = new Response("body");
  const waitUntil = [1, "2", true];
  withWaitUntil(res, Promise.resolve(waitUntil));
  t.is(await res.waitUntil(), waitUntil);
  const res2 = res.clone();
  t.is(await res2.waitUntil(), waitUntil);

  // Check prototype correct and clone still clones non-standard properties
  t.is(Object.getPrototypeOf(res2), Response.prototype);
  const res3 = res2.clone();
  t.is(await res3.waitUntil(), waitUntil);
  t.is(await res.text(), "body");
  t.is(await res2.text(), "body");
  t.is(await res3.text(), "body");
});
test("Response: fails to clone WebSocket response", (t) => {
  const pair = new WebSocketPair();
  const res = new Response(null, {
    status: 101,
    webSocket: pair["0"],
  });
  t.throws(() => res.clone(), {
    instanceOf: TypeError,
    message: "Cannot clone a response to a WebSocket handshake.",
  });
});
test("Response: can be input gated", async (t) => {
  const res = withInputGating(new Response("body"));
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof InputGatedBody);
  await waitsForInputGate(t, () => res.text());
});
test("Response: clone retains input gated option", async (t) => {
  const res = withInputGating(new Response("body"));
  const clone = res.clone();
  await waitsForInputGate(t, () => clone.text());
});

test("withWaitUntil: adds wait until to (Base)Response", async (t) => {
  const waitUntil = [1];
  let res = new Response("body");
  t.is(withWaitUntil(res, Promise.resolve(waitUntil)), res);
  t.is(await res.waitUntil(), waitUntil);

  const baseWaitUntil = [2];
  const baseRes = new BaseResponse("body");
  res = withWaitUntil(baseRes, Promise.resolve(baseWaitUntil));
  t.is(await res.waitUntil(), baseWaitUntil);
});

test("inputGatedFetch: can fetch from existing Request", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const req = new Request(upstream);
  const res = await inputGatedFetch(req);
  t.is(await res.text(), "upstream");
});
test("inputGatedFetch: waits for input gate to open before returning", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  await waitsForInputGate(t, () => inputGatedFetch(upstream));
});
test("inputGatedFetch: Response body is input gated", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const res = await inputGatedFetch(upstream);
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof InputGatedBody);
  const body = await waitsForInputGate(t, () => res.text());
  t.is(body, "upstream");
});

test("logResponse: logs HTTP response with waitUntil", async (t) => {
  const log = new TestLog();
  await logResponse(log, {
    start: process.hrtime(),
    method: "GET",
    url: "http://localhost",
    status: 404,
    waitUntil: Promise.all([Promise.resolve(42)]),
  });
  const [level, message] = log.logs[0];
  t.is(level, LogLevel.NONE);
  t.regex(
    message,
    /GET http:\/\/localhost 404 Not Found \(\d+.\d{2}ms, waitUntil: \d+.\d{2}ms\)/
  );
});
test("logResponse: logs response without status", async (t) => {
  const log = new TestLog();
  await logResponse(log, {
    start: process.hrtime(),
    method: "SCHD",
    url: "http://localhost",
  });
  const [level, message] = log.logs[0];
  t.is(level, LogLevel.NONE);
  t.regex(message, /SCHD http:\/\/localhost \(\d+.\d{2}ms\)/);
});
test("logResponse: logs waitUntil error", async (t) => {
  const log = new TestLog();
  log.error = (message) => log.logWithLevel(LogLevel.ERROR, message.toString());
  await logResponse(log, {
    start: process.hrtime(),
    method: "GET",
    url: "http://localhost",
    status: 200,
    waitUntil: Promise.all([Promise.reject(new TypeError("Test"))]),
  });
  t.is(log.logs.length, 2);
  let [level, message] = log.logs[0];
  t.is(level, LogLevel.ERROR);
  t.regex(message, /^TypeError: Test/);
  [level, message] = log.logs[1];
  t.is(level, LogLevel.NONE);
  t.regex(
    message,
    /GET http:\/\/localhost 200 OK \(\d+.\d{2}ms, waitUntil: \d+.\d{2}ms\)/
  );
});
