import {
  Request,
  Response,
  withImmutableHeaders,
  withWaitUntil,
} from "@miniflare/core";
import { WebSocketPair } from "@miniflare/web-sockets";
import test from "ava";
import { Response as BaseResponse } from "undici";

test("Request: supports non-standard properties", (t) => {
  const cf = { country: "GB" };
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
  const cf = { country: "GB" };
  const req = new Request("http://localhost", {
    method: "POST",
    cf,
  });
  const req2 = req.clone();
  t.is(req2.method, "POST");
  t.deepEqual(req2.cf, cf);
  t.not(req2.cf, req.cf);

  // Check prototype updated and clone still clones non-standard properties
  t.is(Object.getPrototypeOf(req2), Request.prototype);
  const req3 = req2.clone();
  t.is(req3.method, "POST");
  t.deepEqual(req3.cf, cf);
  t.not(req3.cf, req2.cf);
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

  // Check prototype updated and clone still clones non-standard properties
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
