import assert from "assert";
import http from "http";
import { text } from "stream/consumers";
import {
  ReadableStream,
  ReadableStreamDefaultReader,
  TransformStream,
  WritableStream,
} from "stream/web";
import { URL } from "url";
import {
  Body,
  IncomingRequestCfProperties,
  Request,
  RequestInitCfProperties,
  Response,
  _getBodyLength,
  _getURLList,
  _isByteStream,
  createCompatFetch,
  fetch,
  logResponse,
  withImmutableHeaders,
  withInputGating,
  withStringFormDataFiles,
  withWaitUntil,
} from "@miniflare/core";
import {
  Compatibility,
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  InputGate,
  LogLevel,
  NoOpLog,
  RequestContext,
} from "@miniflare/shared";
import {
  TestLog,
  advancesTime,
  triggerPromise,
  useServer,
  utf8Decode,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { WebSocketPair } from "@miniflare/web-sockets";
import test, { Macro, ThrowsExpectation } from "ava";
import {
  Request as BaseRequest,
  Response as BaseResponse,
  BodyMixin,
  File,
  FormData,
  Headers,
  fetch as baseFetch,
} from "undici";

// @ts-expect-error filling out all properties is annoying
const cf: IncomingRequestCfProperties = { country: "GB" };

async function byobReadFirstChunk(body: ReadableStream<Uint8Array> | null) {
  assert(body);
  const reader = body.getReader({ mode: "byob" });
  const result = await reader.read(new Uint8Array(32));
  return utf8Decode(result.value);
}

function unimplementedExpectation(
  klass: "Request" | "Response",
  property: keyof Request | keyof Response
): ThrowsExpectation {
  return {
    instanceOf: Error,
    message: `Failed to get the '${String(
      property
    )}' property on '${klass}': the property is not implemented.`,
  };
}

test('Headers: getAll: throws if key not "Set-Cookie"', (t) => {
  const headers = new Headers();
  // @ts-expect-error getAll is added to the Headers prototype by importing
  // @miniflare/core
  t.throws(() => headers.getAll("set-biscuit"), {
    instanceOf: TypeError,
    message: 'getAll() can only be used with the header name "Set-Cookie".',
  });
});
test("Headers: getAll: returns empty array if no headers", (t) => {
  const headers = new Headers();
  // @ts-expect-error getAll is added to the Headers prototype by importing
  // @miniflare/core
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
  // @ts-expect-error getAll is added to the Headers prototype by importing
  // @miniflare/core
  t.deepEqual(headers.getAll("set-CoOkiE"), [cookie1, cookie2, cookie3]);
});

// These tests also implicitly test withInputGating
test("Body: body isn't input gated by default", async (t) => {
  const inputGate = new InputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();
  await inputGate.runWith(async () => {
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    const body = new Body(new BaseResponse("body")).body;
    assert(body);
    // @ts-expect-error @types/node stream/consumers doesn't accept ReadableStream
    t.is(await text(body), "body");
  });
  openTrigger();
});
test("Body: body returns null with null body", (t) => {
  const body = new Body(new BaseResponse(null));
  t.is(body.body, null);
});
test("Body: same body instance is always returned", (t) => {
  const body = new Body(new BaseResponse("body"));
  t.not(body.body, null);
  t.is(body.body, body.body);
});
test("Body: body isn't locked until read from", async (t) => {
  const res = new Response("body");
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Body);
  // noinspection SuspiciousTypeOfGuard
  assert(res.body instanceof ReadableStream);

  // Access property that doesn't read any data
  t.false(res.body.locked);
  // Check we can still clone the body
  const clone = res.clone();
  t.is(await clone.text(), "body");
});
test("Body: can pause, resume and cancel body stream", async (t) => {
  const chunks = ["123", "456", "789"];
  const bodyStream = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) {
        controller.enqueue(utf8Encode(chunk));
      } else {
        controller.close();
      }
    },
  });
  const { body } = new Response(bodyStream);
  assert(body);

  let reader = body.getReader();
  let result = await reader.read();
  t.false(result.done);
  t.is(utf8Decode(result.value), "123");

  reader.releaseLock();
  reader = body.getReader();
  result = await reader.read();
  t.false(result.done);
  t.is(utf8Decode(result.value), "456");

  await reader.cancel(new Error("Cancelled!"));
  result = await reader.read();
  t.true(result.done);
  t.is(result.value, undefined);

  reader.releaseLock();
  reader = body.getReader();
  result = await reader.read();
  t.true(result.done);
  t.is(result.value, undefined);
});
test("Body: can cancel body directly", async (t) => {
  const chunks = ["123", "456", "789"];
  const bodyStream = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) {
        controller.enqueue(utf8Encode(chunk));
      } else {
        controller.close();
      }
    },
  });
  const { body } = new Response(bodyStream);
  assert(body);

  await body.cancel();
  const result = await body.getReader().read();
  t.true(result.done);
  t.is(result.value, undefined);
});
test("Body: throws on string chunks", async (t) => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue("I'm a string");
      controller.close();
    },
  });
  const { body } = new Response(inputStream);
  assert(body);
  await t.throwsAsync(body.getReader().read(), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received a string on its writable side. " +
      "If you wish to write a string, you'll probably want to " +
      "explicitly UTF-8-encode it with TextEncoder.",
  });
});
test("Body: throws on non-ArrayBuffer/ArrayBufferView chunks", async (t) => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue(42);
      controller.close();
    },
  });
  const { body } = new Response(inputStream);
  assert(body);
  await t.throwsAsync(body.getReader().read(), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received an object of non-ArrayBuffer/ArrayBufferView " +
      "type on its writable side.",
  });
});

const inputGatedBodyMacro: Macro<[(body: ReadableStream) => Promise<any>]> =
  async (t, closure) => {
    const res = withInputGating(new Body(new BaseResponse("body")));
    // @ts-expect-error res.body is a ReadableStream
    const body: ReadableStream = res.body;
    await waitsForInputGate(t, () => closure(body));
  };
inputGatedBodyMacro.title = (providedTitle) =>
  `Body: body.${providedTitle}() applies input gating`;
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
    const body = new Body(res.clone());
    t.not(await body?.[key](), undefined);
  });
  openTrigger();

  // Check input gating can be enabled
  await waitsForInputGate(t, async () => {
    const body = withInputGating(new Body(res));
    await body?.[key]();
  });
};
inputGatedConsumerMacro.title = (providedTitle, key) =>
  `Body: ${key}() applies input gating`;
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
test("Body: formData: parses regular form data fields", async (t) => {
  // Check with application/x-www-form-urlencoded Content-Type
  let body = new Body(
    new BaseResponse("key1=value1&key2=value2", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
  );
  let formData = await body.formData();
  t.is(formData.get("key1"), "value1");
  t.is(formData.get("key2"), "value2");

  // Check with multipart/form-data Content-Type
  body = new Body(
    new BaseResponse(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key1"',
        "",
        "multipart value1",
        "--boundary",
        'Content-Disposition: form-data; name="key2"',
        "",
        "multipart value2",
        "--boundary",
        'Content-Disposition: form-data; name="key2"',
        "",
        "second value2",
        "--boundary--",
      ].join("\r\n"),
      { headers: { "content-type": 'multipart/form-data;boundary="boundary"' } }
    )
  );
  formData = await body.formData();
  t.is(formData.get("key1"), "multipart value1");
  t.deepEqual(formData.getAll("key2"), ["multipart value2", "second value2"]);
});
test("Body: formData: parses files as File objects by default", async (t) => {
  const body = new Body(
    new BaseResponse(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key"; filename="test.txt"',
        "Content-Type: text/plain",
        "",
        "file contents",
        "--boundary--",
      ].join("\r\n"),
      { headers: { "content-type": 'multipart/form-data;boundary="boundary"' } }
    )
  );
  const formData = await body.formData();
  const file = formData.get("key");
  assert(file instanceof File);
  t.is(await file.text(), "file contents");
  t.is(file.name, "test.txt");
});
test("Body: formData: preserves path of File objects", async (t) => {
  const body = new Body(
    new BaseResponse(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key"; filename="directory/test.txt"',
        "Content-Type: text/plain",
        "",
        "file contents",
        "--boundary--",
      ].join("\r\n"),
      { headers: { "content-type": 'multipart/form-data;boundary="boundary"' } }
    )
  );
  const formData = await body.formData();
  const file = formData.get("key");
  assert(file instanceof File);
  t.is(await file.text(), "file contents");
  t.is(file.name, "directory/test.txt");
});
test("Body: formData: parses files as strings if option set", async (t) => {
  let body = new Body(
    new BaseResponse(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key"; filename="test.txt"',
        "Content-Type: text/plain",
        "",
        "file contents",
        "--boundary--",
      ].join("\r\n"),
      { headers: { "content-type": 'multipart/form-data;boundary="boundary"' } }
    )
  );
  body = withStringFormDataFiles(body);
  const formData = await body.formData();
  t.is(formData.get("key"), "file contents");
});
test("Body: formData: respects Content-Transfer-Encoding header for base64 encoded files", async (t) => {
  let body = new Body(
    new BaseResponse(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key"; filename="test.txt"',
        "Content-Transfer-Encoding: base64",
        "Content-Type: text/plain",
        "",
        "dGVzdA==", // test
        "--boundary--",
      ].join("\r\n"),
      { headers: { "content-type": 'multipart/form-data;boundary="boundary"' } }
    )
  );
  body = withStringFormDataFiles(body);
  const formData = await body.formData();
  t.is(formData.get("key"), "test");
});
test("Body: formData: throw error on missing boundary in Content-Type header", async (t) => {
  // Check with multipart/form-data Content-Type
  const body = new Body(
    new BaseResponse(["second value2", "--boundary--"].join("\r\n"), {
      headers: { "content-type": "multipart/form-data" },
    })
  );
  await t.throwsAsync(body.formData(), {
    instanceOf: TypeError,
    message: "Multipart: Boundary not found",
  });
});
test("Body: formData: throw error on unsupported Content-Type header", async (t) => {
  // Check with application/json Content-Type
  const body = new Body(
    new BaseResponse(["second value2", "--boundary--"].join("\r\n"), {
      headers: { "content-type": "application/json" },
    })
  );
  await t.throwsAsync(body.formData(), {
    instanceOf: TypeError,
    message: "Unsupported content type: application/json",
  });
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
  // Headers wouldn't be the same instance if cloned
  t.is(req.headers, base.headers);
  // Bodies are different, as we create a readable byte stream for each Request
  t.not(req.body, base.body);

  t.is(req.method, base.method);
  t.is(req.redirect, base.redirect);
  t.is(req.url, base.url);
  t.is(req.signal, base.signal);

  // Check new BaseRequest created if RequestInit passed
  req = new Request(base, {
    method: "PATCH",
  });
  // Should be different as new instance created
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
test("Request: can construct new Request with stream body", async (t) => {
  let stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8Encode("chunk1"));
      controller.close();
    },
  });
  let req = new Request("http://localhost", { method: "POST", body: stream });
  t.is(await req.text(), "chunk1");

  // Check again with byte stream
  stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      controller.enqueue(utf8Encode("chunk2"));
      controller.close();
    },
  });
  req = new Request("http://localhost", { method: "POST", body: stream });
  t.is(await req.text(), "chunk2");
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
test("Request: cf defaults to input.cf", (t) => {
  const req = new Request("http://localhost", {
    method: "POST",
    cf,
  });
  const req2 = new Request(req);
  t.deepEqual(req.cf, req2.cf);
  // Check cf has been cloned
  t.not(req.cf, req2.cf);
});
test("Request: init.cf overrides input.cf", (t) => {
  const req = new Request("http://localhost", {
    method: "POST",
    cf,
  });
  const req2 = new Request(req, {
    cf: {
      cacheKey: "test",
    },
  });
  t.notDeepEqual(req.cf, req2.cf);
  t.is((req2.cf as RequestInitCfProperties).cacheKey, "test");
});
test("Request: doesn't detach ArrayBuffers", async (t) => {
  // Check with ArrayBuffer
  const buffer = utf8Encode("test1").buffer;
  let req = new Request("http://localhost", { method: "POST", body: buffer });
  t.is(await text(req.body as any), "test1");
  req = new Request("http://localhost", { method: "POST", body: buffer });
  t.is(await text(req.body as any), "test1");

  // Check with Uint8Array
  const array = utf8Encode("test2");
  req = new Request("http://localhost", { method: "POST", body: array });
  t.is(await text(req.body as any), "test2");
  req = new Request("http://localhost", { method: "POST", body: array });
  t.is(await text(req.body as any), "test2");
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
test("Request: clones stream bodies", async (t) => {
  let stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8Encode("chunk1"));
      controller.close();
    },
  });
  const init = { method: "POST", body: stream };
  const initClone = { ...init };
  let req = new Request("http://localhost", init);
  t.deepEqual(init, initClone);
  let clone = req.clone();
  assert(req.body !== null && clone.body !== null);
  t.true(_isByteStream(req.body));
  t.true(_isByteStream(clone.body));
  t.is(await req.text(), "chunk1");
  t.is(await clone.text(), "chunk1");

  // Check again with byte stream
  stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      controller.enqueue(utf8Encode("chunk2"));
      controller.close();
    },
  });
  req = new Request("http://localhost", { method: "POST", body: stream });
  clone = req.clone();
  assert(req.body !== null && clone.body !== null);
  t.true(_isByteStream(req.body));
  t.true(_isByteStream(clone.body));
  t.is(await req.text(), "chunk2");
  t.is(await clone.text(), "chunk2");
});
test("Request: can be input gated", async (t) => {
  const req = withInputGating(
    new Request("http://localhost", { method: "POST", body: "body" })
  );
  // noinspection SuspiciousTypeOfGuard
  t.true(req instanceof Body);
  await waitsForInputGate(t, () => req.text());
});
test("Request: clone retains input gated option", async (t) => {
  const req = withInputGating(
    new Request("http://localhost", { method: "POST", body: "body" })
  );
  const clone = req.clone();
  await waitsForInputGate(t, () => clone.text());
});
test("Request: clone retains form data file parsing option", async (t) => {
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  // Implicitly testing FormData body encoding here too
  let req = new Request("https://host", { method: "POST", body: formData });
  let clone = req.clone();
  let resFormData = await clone.formData();
  const file = resFormData.get("file");
  assert(file instanceof File);
  t.is(await file.text(), "test");
  t.is(file.name, "test.txt");

  req = new Request("https://host", { method: "POST", body: formData });
  req = withStringFormDataFiles(req);
  clone = req.clone();
  resFormData = await clone.formData();
  t.is(resFormData.get("file"), "test");
});
test("Request: Object.keys() returns getters", async (t) => {
  const req = new Request("http://localhost", {
    headers: { "X-Key": "value " },
  });
  const keys = Object.keys(req);
  const expectedKeys = [
    "body",
    "bodyUsed",
    "headers",
    "cf",
    "signal",
    "redirect",
    "url",
    "method",
  ];
  t.deepEqual(keys.sort(), expectedKeys.sort());
});
test("Request: can mutate forbidden headers after construction", async (t) => {
  // From https://github.com/nodejs/undici/blob/cd566ccf65c18b8405793a752247f3e350a50fcf/lib/fetch/constants.js#L3-L24
  const forbiddenHeaderNames = [
    "accept-charset",
    "accept-encoding",
    "access-control-request-headers",
    "access-control-request-method",
    "connection",
    "content-length",
    "cookie",
    "cookie2",
    "date",
    "dnt",
    "expect",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "via",
  ];

  const req = new Request("http://localhost");
  for (const header of forbiddenHeaderNames) {
    req.headers.set(header, "value");
    t.is(req.headers.get(header), "value");
  }

  // Check this still works on a clone
  const req2 = req.clone();
  for (const header of forbiddenHeaderNames) {
    t.is(req2.headers.get(header), "value");
    req2.headers.set(header, "value2");
    t.is(req2.headers.get(header), "value2");
  }
});
test("Request: can use byob reader for body", async (t) => {
  const { body } = new Request("https://a", { method: "POST", body: "body" });
  assert(body);
  const reader = body.getReader({ mode: "byob" });
  const result = await reader.read(new Uint8Array(32));
  t.is(utf8Decode(result.value), "body");
});
test("Request: can use byob reader when cloning", async (t) => {
  let req = new Request("https://a", { method: "POST", body: "body" });
  let clone = req.clone();
  t.is(await byobReadFirstChunk(req.body), "body");
  t.is(await byobReadFirstChunk(clone.body), "body");

  // Check reading the clone first too
  req = new Request("https://a", { method: "POST", body: "body" });
  clone = req.clone();
  t.is(await byobReadFirstChunk(clone.body), "body");
  t.is(await byobReadFirstChunk(req.body), "body");
});
test("Request: should be locked when attaching a reader", async (t) => {
  const req = new Request("http://localhost", { method: "POST", body: "body" });
  // noinspection SuspiciousTypeOfGuard
  t.true(req instanceof Body);
  // noinspection SuspiciousTypeOfGuard
  assert(req.body instanceof ReadableStream);
  t.false(req.body.locked);
  const reader = req.body.getReader();
  // noinspection SuspiciousTypeOfGuard
  assert(reader instanceof ReadableStreamDefaultReader);
  t.true(req.body.locked);
});
test("Request: should reset bodyStream when body is cloned", async (t) => {
  const reqBody = new ArrayBuffer(10);
  const req = new Request("http://localhost", {
    method: "POST",
    body: reqBody,
  });
  // noinspection SuspiciousTypeOfGuard
  t.true(req instanceof Body);
  const bodyStream = req.body;
  assert(bodyStream instanceof ReadableStream);
  // Clone the request. undici will change the `body.stream` to a new clone.
  const cloneReq = req.clone();
  t.deepEqual(await cloneReq.arrayBuffer(), reqBody);
  // We can loop over body. This is what http-server writeResponse() does.
  if (req.body) {
    for await (const chunk of req.body) {
      // noinspection SuspiciousTypeOfGuard
      assert(chunk instanceof Uint8Array);
    }
  }
  // Expect that the internal bodyStream also changed
  t.not(bodyStream, req.body);
});
test("Request: access to unimplemented properties throws error", async (t) => {
  const req = new Request("https://a");
  t.throws(() => req.context, unimplementedExpectation("Request", "context"));
  t.throws(() => req.mode, unimplementedExpectation("Request", "mode"));
  t.throws(
    () => req.credentials,
    unimplementedExpectation("Request", "credentials")
  );
  t.throws(
    () => req.integrity,
    unimplementedExpectation("Request", "integrity")
  );
  t.throws(() => req.cache, unimplementedExpectation("Request", "cache"));
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

  // Check clone still has immutable headers
  const clone = req.clone();
  t.throws(() => clone.headers.set("X-Key", "new"), {
    instanceOf: TypeError,
    message: "immutable",
  });
  t.is(clone.headers.get("X-Key"), "value");
});

test("Response.redirect: creates redirect response", (t) => {
  let res = Response.redirect("http://localhost/", 307);
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Response);
  t.is(res.headers.get("Location"), "http://localhost/");

  // Check status defaults to 302
  res = Response.redirect("http://localhost/");
  t.is(res.status, 302);
  t.is(res.headers.get("Location"), "http://localhost/");
});
test("Response.json: creates JSON response", async (t) => {
  const res = Response.json({ a: 1 }, { headers: { "X-Key": "value" } });
  t.is(res.status, 200);
  t.is(res.headers.get("Content-Type"), "application/json");
  t.is(res.headers.get("X-Key"), "value");
  t.deepEqual(await res.json(), { a: 1 });
});

test("Response: constructing from BaseResponse doesn't create new BaseResponse unless required", async (t) => {
  const base = new BaseResponse("<p>test</p>", {
    status: 404,
    statusText: "Not Found",
    headers: { "Content-Type": "text/html" },
  });
  let res = new Response(base.body, base);
  // Headers wouldn't be the same if cloned
  t.is(res.headers, base.headers);
  // Bodies are different, as we create a readable byte stream for each Request
  t.not(res.body, base.body);

  t.is(res.status, base.status);
  t.is(res.ok, base.ok);
  t.is(res.statusText, base.statusText);
  t.is(res.url, base.url);
  t.is(res.redirected, base.redirected);

  // Check new BaseResponse created if different body passed
  res = new Response("<p>new</p>", base);
  // Should be different as new instance created
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
    encodeBody: "manual",
    status: 101,
    webSocket: pair["0"],
    headers: { "X-Key": "value" },
  });
  t.is(res.encodeBody, "manual");
  t.is(res.status, 101);
  t.is(res.webSocket, pair[0]);
  t.is(res.headers.get("X-Key"), "value");
});
test("Response: encodeBody defaults to auto", (t) => {
  const res = new Response(null);
  t.is(res.encodeBody, "automatic");
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
    message: 'init["status"] must be in the range of 200 to 599, inclusive.',
  });
});
test("Response: allows empty string for null body", (t) => {
  for (const nullBodyStatus of [204, 205, 304]) {
    const res = new Response("", { status: nullBodyStatus });
    t.is(res.status, nullBodyStatus);
    t.is(res.body, null, nullBodyStatus.toString());
  }
});
test("Response: doesn't detach ArrayBuffers", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/171
  // Check with ArrayBuffer
  const buffer = utf8Encode("test1").buffer;
  let res = new Response(buffer);
  t.is(await text(res.body as any), "test1");
  res = new Response(buffer);
  t.is(await text(res.body as any), "test1");

  // Check with Uint8Array
  const array = utf8Encode("test2");
  res = new Response(array);
  t.is(await text(res.body as any), "test2");
  res = new Response(array);
  t.is(await text(res.body as any), "test2");
});
test("Response: clones non-standard properties", async (t) => {
  const res = new Response("body", { encodeBody: "manual" });
  const waitUntil = [1, "2", true];
  withWaitUntil(res, Promise.resolve(waitUntil));
  t.is(await res.waitUntil(), waitUntil);
  const res2 = res.clone();
  t.is(res2.encodeBody, "manual");
  t.is(await res2.waitUntil(), waitUntil);

  // Check prototype correct and clone still clones non-standard properties
  t.is(Object.getPrototypeOf(res2), Response.prototype);
  const res3 = res2.clone();
  t.is(res3.encodeBody, "manual");
  t.is(await res3.waitUntil(), waitUntil);
  t.is(await res.text(), "body");
  t.is(await res2.text(), "body");
  t.is(await res3.text(), "body");
});
test("Response: clones stream bodies", async (t) => {
  let stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8Encode("chunk1"));
      controller.close();
    },
  });
  let res = new Response(stream);
  let clone = res.clone();
  assert(res.body !== null && clone.body !== null);
  t.true(_isByteStream(res.body));
  t.true(_isByteStream(clone.body));
  t.is(await res.text(), "chunk1");
  t.is(await clone.text(), "chunk1");

  // Check again with byte stream
  stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      controller.enqueue(utf8Encode("chunk2"));
      controller.close();
    },
  });
  res = new Response(stream);
  clone = res.clone();
  assert(res.body !== null && clone.body !== null);
  t.true(_isByteStream(res.body));
  t.true(_isByteStream(clone.body));
  t.is(await res.text(), "chunk2");
  t.is(await clone.text(), "chunk2");
});
test("Response: constructing from Response copies non-standard properties", (t) => {
  const pair = new WebSocketPair();
  const res = new Response("body1", {
    encodeBody: "manual",
    status: 101,
    webSocket: pair["0"],
  });
  const res2 = new Response("body2", res);
  t.is(res2.encodeBody, "manual");
  t.is(res2.status, 101);
  t.is(res2.webSocket, pair["0"]);
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
  t.true(res instanceof Body);
  await waitsForInputGate(t, () => res.text());
});
test("Response: clone retains input gated option", async (t) => {
  const res = withInputGating(new Response("body"));
  const clone = res.clone();
  await waitsForInputGate(t, () => clone.text());
});
test("Response: clone retains form data file parsing option", async (t) => {
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  // Implicitly testing FormData body encoding here too
  let res = new Response(formData);
  let clone = res.clone();
  let resFormData = await clone.formData();
  const file = resFormData.get("file");
  assert(file instanceof File);
  t.is(await file.text(), "test");
  t.is(file.name, "test.txt");

  res = new Response(formData);
  res = withStringFormDataFiles(res);
  clone = res.clone();
  resFormData = await clone.formData();
  t.is(resFormData.get("file"), "test");
});
test("Response: clones null body", async (t) => {
  const res = new Response(null, { status: 201 });
  const clone = res.clone();
  t.is(clone.body, null);
});
test("Response: Object.keys() returns getters", async (t) => {
  const res = new Response("body", { headers: { "X-Key": "value " } });
  const keys = Object.keys(res);
  const expectedKeys = [
    "body",
    "bodyUsed",
    "headers",
    "ok",
    "redirected",
    "status",
    "statusText",
    "url",
    "webSocket",
  ];
  t.deepEqual(keys.sort(), expectedKeys.sort());
});
test("Response: can mutate forbidden headers after construction", async (t) => {
  // From https://github.com/nodejs/undici/blob/cd566ccf65c18b8405793a752247f3e350a50fcf/lib/fetch/constants.js#L61
  const forbiddenResponseHeaderNames = ["set-cookie", "set-cookie2"];

  const res = new Response("body");
  for (const header of forbiddenResponseHeaderNames) {
    res.headers.set(header, "value");
    t.is(res.headers.get(header), "value");
  }

  // Check this still works on a clone
  const res2 = res.clone();
  for (const header of forbiddenResponseHeaderNames) {
    t.is(res2.headers.get(header), "value");
    res2.headers.set(header, "value2");
    t.is(res2.headers.get(header), "value2");
  }
});
test("Response: can use byob reader for body", async (t) => {
  const { body } = new Response("body");
  assert(body);
  const reader = body.getReader({ mode: "byob" });
  const result = await reader.read(new Uint8Array(32));
  t.is(utf8Decode(result.value), "body");
});
test("Response: can use byob reader when cloning", async (t) => {
  let res = new Response("body");
  let clone = res.clone();
  t.is(await byobReadFirstChunk(res.body), "body");
  t.is(await byobReadFirstChunk(clone.body), "body");

  // Check reading the clone first too
  res = new Response("body");
  clone = res.clone();
  t.is(await byobReadFirstChunk(clone.body), "body");
  t.is(await byobReadFirstChunk(res.body), "body");
});
test("Response: should be locked when attaching a reader", async (t) => {
  const res = new Response("body");
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Body);
  // noinspection SuspiciousTypeOfGuard
  assert(res.body instanceof ReadableStream);
  t.false(res.body.locked);
  const reader = res.body.getReader();
  // noinspection SuspiciousTypeOfGuard
  assert(reader instanceof ReadableStreamDefaultReader);
  t.true(res.body.locked);
});
test("Response: should reset bodyStream when body is cloned", async (t) => {
  const resBody = new ArrayBuffer(10);
  const res = new Response(resBody);
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Body);
  const bodyStream = res.body;
  assert(bodyStream instanceof ReadableStream);
  // Clone the response. undici will change the `body.stream` to a new clone.
  const cloneRes = res.clone();
  t.deepEqual(await cloneRes.arrayBuffer(), resBody);
  // We can loop over body. This is what http-server writeResponse() does.
  if (res.body) {
    for await (const chunk of res.body) {
      // noinspection SuspiciousTypeOfGuard
      assert(chunk instanceof Uint8Array);
    }
  }
  // Expect that the internal bodyStream also changed
  t.not(bodyStream, res.body);
});
test("Response: access to unimplemented properties throws error", async (t) => {
  const res = new Response();
  t.throws(() => res.type, unimplementedExpectation("Response", "type"));
  t.throws(
    () => res.useFinalUrl,
    unimplementedExpectation("Response", "useFinalUrl")
  );
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

function redirectingServerListener(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const { searchParams } = new URL(req.url ?? "", "http://localhost");
  const n = parseInt(searchParams.get("n") ?? "0");
  if (n > 0) {
    res.writeHead(302, { Location: `/?n=${n - 1}`, "Set-Cookie": `n=${n}` });
  } else {
    res.writeHead(200);
  }
  res.end();
}
test("_getURLList: extracts URL list from Response", async (t) => {
  const upstream = (await useServer(t, redirectingServerListener)).http;
  const url = new URL("/?n=3", upstream);
  const res = await baseFetch(url);
  const urlList = _getURLList(res);
  t.deepEqual(urlList?.map(String), [
    `${upstream.origin}/?n=3`,
    `${upstream.origin}/?n=2`,
    `${upstream.origin}/?n=1`,
    `${upstream.origin}/?n=0`,
  ]);
});

test("_getBodyLength: extracts actual Response Content-Length", async (t) => {
  let res = new Response("body", { headers: { "Content-Length": "100" } });
  t.is(_getBodyLength(res), 4);
  res = new Response(new Uint8Array([1, 2, 3]));
  t.is(_getBodyLength(res), 3);
  res = new Response(null);
  t.is(_getBodyLength(res), undefined);
  res = new Response(new ReadableStream(), {
    headers: { "Content-Length": "50" },
  });
  t.is(_getBodyLength(res), undefined);
});

test("fetch: can fetch from existing Request", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const req = new Request(upstream);
  const res = await fetch(req);
  t.is(await res.text(), "upstream");
});
test("fetch: gives a null body for upstream null body status codes", async (t) => {
  const upstream = (
    await useServer(t, (req, res) => {
      res.statusCode = 304;
      res.end();
    })
  ).http;
  const req = new Request(upstream);
  const res = await fetch(req);
  t.is(res.status, 304);
  t.is(await res.text(), "");
});
test("fetch: increments subrequest count", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  await ctx.runWith(() => fetch(upstream));
  t.is(ctx.externalSubrequests, 1);
});
test("fetch: increments subrequest count for each redirect", async (t) => {
  const upstream = (await useServer(t, redirectingServerListener)).http;
  const url = new URL("/?n=3", upstream);
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  await ctx.runWith(() => fetch(url));
  t.is(ctx.externalSubrequests, 4);
});
test("fetch: advances current time", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  await advancesTime(t, () => fetch(upstream));
});
test("fetch: waits for output gate to open before fetching", async (t) => {
  let fetched = false;
  const upstream = (
    await useServer(t, (req, res) => {
      fetched = true;
      res.end("upstream");
    })
  ).http;
  await waitsForOutputGate(
    t,
    () => fetch(upstream),
    () => fetched
  );
});
test("fetch: removes Host and CF-Connecting-IP headers from Request", async (t) => {
  const upstream = (
    await useServer(t, (req, res) => res.end(JSON.stringify(req.headers)))
  ).http;
  const res = await fetch(upstream, {
    headers: {
      Host: "miniflare.dev",
      "CF-Connecting-IP": "127.0.0.1",
      "X-Real-IP": "127.0.0.1",
    },
  });
  const headers = await res.json();
  t.like(headers, {
    host: upstream.host,
    "x-real-ip": "127.0.0.1",
  });
});
test("fetch: removes Content-Length 0 from body-less requests", async (t) => {
  // Should remove content-length: 0 from certain methods because undici sees it
  // as an error: https://github.com/cloudflare/miniflare/issues/193
  const upstream = (
    await useServer(t, (req, res) => res.end(JSON.stringify(req.headers)))
  ).http;
  const res = await fetch(upstream, {
    method: "DELETE",
    headers: {
      "Content-Length": "0",
    },
  });
  const headers = await res.json();
  t.like(headers, {
    host: upstream.host,
  });
});
test("fetch: removes default fetch headers from Request unless explicitly added", async (t) => {
  // Should remove accept, accept-language, sec-fetch-mode, and user-agent
  // headers unless explicitly added: https://github.com/cloudflare/miniflare/issues/139

  const upstream = (
    await useServer(t, (req, res) => res.end(JSON.stringify(req.headers)))
  ).http;

  function removeExpected(headers: any): any {
    delete headers["accept-encoding"];
    delete headers["connection"];
    delete headers["host"];
    delete headers["mf-loop"];
    return headers;
  }

  // Check with no additional headers
  let res = await fetch(upstream, { headers: { "CF-Ray": "ray1" } });
  t.deepEqual(removeExpected(await res.json()), { "cf-ray": "ray1" });

  // Check with single additional header
  res = await fetch(upstream, {
    headers: {
      "User-Agent": "miniflare-test2",
      "CF-Ray": "ray2",
    },
  });
  t.deepEqual(removeExpected(await res.json()), {
    "user-agent": "miniflare-test2",
    "cf-ray": "ray2",
  });

  // Check with all additional headers
  res = await fetch(upstream, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "en",
      "User-Agent": "miniflare-test3",
      "CF-Ray": "ray3",
    },
  });
  t.deepEqual(removeExpected(await res.json()), {
    accept: "text/html",
    "accept-language": "en",
    "user-agent": "miniflare-test3",
    "cf-ray": "ray3",
  });
});
test("fetch: accepts stream body", async (t) => {
  const upstream = (await useServer(t, (req, res) => req.pipe(res))).http;

  let stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8Encode("chunk1"));
      controller.close();
    },
  });
  const init = { method: "POST", body: stream };
  const initClone = { ...init };
  let res = await fetch(upstream, init);
  t.deepEqual(init, initClone);
  t.is(await res.text(), "chunk1");

  stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      controller.enqueue(utf8Encode("chunk2"));
      controller.close();
    },
  });
  res = await fetch(upstream, { method: "POST", body: stream });
  t.is(await res.text(), "chunk2");
});
test("fetch: uses known content length if possible", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/522
  const upstream = (
    await useServer(t, (req, res) => {
      res.end(String(req.headers["transfer-encoding"]));
    })
  ).http;

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8Encode("chunk"));
      controller.close();
    },
  });
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Length": "5" },
    body,
  });
  const res = await fetch(upstream, { method: "POST", body: request.body });
  t.is(await res.text(), "undefined");
});
test('fetch: returns full Response for "manual" redirect', async (t) => {
  const upstream = (await useServer(t, redirectingServerListener)).http;
  const url = new URL("/?n=3", upstream);
  const res = await fetch(url, { redirect: "manual" });
  t.is(res.status, 302);
  t.is(res.statusText, "Found");
  t.is(res.headers.get("Location"), `/?n=2`);
  t.is(res.headers.get("Set-Cookie"), "n=3");
  // https://github.com/cloudflare/miniflare/issues/177
  t.is(res.url, url.href);
});
test("fetch: waits for input gate to open before returning", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  await waitsForInputGate(t, () => fetch(upstream));
});
test("fetch: Response body is input gated", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const res = await fetch(upstream);
  // noinspection SuspiciousTypeOfGuard
  t.true(res instanceof Body);
  const body = await waitsForInputGate(t, () => res.text());
  t.is(body, "upstream");
});
test("fetch: Response headers are immutable", async (t) => {
  const upstream = (
    await useServer(t, (req, res) => {
      res.writeHead(200, { "X-Key": "value" });
      res.end("upstream");
    })
  ).http;
  const res = await fetch(upstream);
  t.throws(() => res.headers.set("X-Key", "new"), { instanceOf: TypeError });
  t.is(res.headers.get("X-Key"), "value");

  const mutable = new Response(res.body, res);
  mutable.headers.set("X-Key", "new");
  t.is(mutable.headers.get("X-Key"), "new");
});

test("createCompatFetch: throws outside request handler unless globalAsyncIO set", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const log = new NoOpLog();
  const compat = new Compatibility();
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  let fetch = createCompatFetch({ log, compat });
  await t.throwsAsync(fetch(upstream), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });
  let res = await ctx.runWith(() => fetch(upstream));
  t.is(await res.text(), "upstream");

  fetch = createCompatFetch({ log, compat, globalAsyncIO: true });
  res = await fetch(upstream);
  t.is(await res.text(), "upstream");
  res = await ctx.runWith(() => fetch(upstream));
  t.is(await res.text(), "upstream");
});
test("createCompatFetch: refuses unknown protocols if compatibility flag enabled", async (t) => {
  const log = new TestLog();
  let upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  upstream = new URL(upstream.toString().replace("http:", "random:"));
  // Check with flag disabled first
  let fetch = createCompatFetch({
    log,
    compat: new Compatibility(undefined, [
      "fetch_treats_unknown_protocols_as_http",
    ]),
    globalAsyncIO: true,
  });
  const res = await fetch(upstream);
  t.is(await res.text(), "upstream");
  // Check original URL copied and protocol not mutated
  t.is(upstream.protocol, "random:");
  // Check warning logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 1);
  t.regex(
    warnings[0],
    /URLs passed to fetch\(\) must begin with either 'http:' or 'https:', not 'random:'/
  );
  t.notRegex(
    warnings[0],
    /fetch\(\) treats WebSockets as a special kind of HTTP request/
  );

  // Check with flag enabled
  log.logs = [];
  fetch = createCompatFetch({
    log,
    compat: new Compatibility(undefined, ["fetch_refuses_unknown_protocols"]),
    globalAsyncIO: true,
  });
  await t.throwsAsync(async () => fetch(upstream), {
    instanceOf: TypeError,
    message: `Fetch API cannot load: ${upstream.toString()}`,
  });
  t.is(log.logs.length, 0);
});
test("createCompatFetch: recognises http and https as known protocols", async (t) => {
  const fetch = createCompatFetch(
    {
      log: new NoOpLog(),
      compat: new Compatibility(undefined, ["fetch_refuses_unknown_protocols"]),
      globalAsyncIO: true,
    },
    async () => new Response("upstream")
  );
  t.is(await (await fetch("http://localhost/")).text(), "upstream");
  t.is(await (await fetch("https://localhost/")).text(), "upstream");
});
test("createCompatFetch: rewrites urls of all types of fetch inputs", async (t) => {
  const { http: upstream } = await useServer(t, (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () =>
      res.end(`${req.method}:${req.headers["x-key"] ?? ""}:${body}`)
    );
  });
  upstream.protocol = "ftp:";
  const fetch = createCompatFetch({
    log: new NoOpLog(),
    compat: new Compatibility(undefined, [
      "fetch_treats_unknown_protocols_as_http",
    ]),
    globalAsyncIO: true,
  });

  let res = await fetch(upstream.toString(), {
    method: "POST",
    headers: { "x-key": "value" },
    body: "body",
  });
  t.is(await res.text(), "POST:value:body");

  res = await fetch(upstream, {
    method: "POST",
    headers: { "x-key": "value" },
    body: "body",
  });
  t.is(await res.text(), "POST:value:body");

  res = await fetch(
    new Request(upstream, {
      method: "POST",
      headers: { "x-key": "value" },
      body: "body",
    })
  );
  t.is(await res.text(), "POST:value:body");

  res = await fetch(
    new BaseRequest(upstream, {
      method: "POST",
      headers: { "x-key": "value" },
      body: "body",
    })
  );
  t.is(await res.text(), "POST:value:body");

  res = await fetch(
    new Request(upstream, {
      method: "POST",
      headers: { "x-key": "value" },
      body: "body",
    }),
    { body: "body2" }
  );
  t.is(await res.text(), "POST:value:body2");

  res = await fetch(
    new BaseRequest(upstream, {
      method: "POST",
      headers: { "x-key": "value", body: "body" },
    }),
    { body: "body2" }
  );
  t.is(await res.text(), "POST:value:body2");
});
test("createCompatFetch: Responses parse files in FormData as File objects only if compatibility flag enabled", async (t) => {
  const { http: upstream } = await useServer(t, (req, res) => {
    res.writeHead(200, {
      "Content-Type": 'multipart/form-data;boundary="boundary"',
    });
    res.end(
      [
        "--boundary",
        'Content-Disposition: form-data; name="key"; filename="test.txt"',
        "Content-Type: text/plain",
        "",
        "file contents",
        "--boundary--",
      ].join("\r\n")
    );
  });

  const log = new NoOpLog();
  let fetch = createCompatFetch({
    log,
    compat: new Compatibility(),
    globalAsyncIO: true,
  });
  let formData = await (await fetch(upstream)).formData();
  t.is(formData.get("key"), "file contents");

  fetch = createCompatFetch({
    log,
    compat: new Compatibility(undefined, ["formdata_parser_supports_files"]),
    globalAsyncIO: true,
  });
  formData = await (await fetch(upstream)).formData();
  const file = formData.get("key");
  assert(file instanceof File);
  t.is(await file.text(), "file contents");
  t.is(file.name, "test.txt");
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
test("logResponse: logs CPU time", async (t) => {
  const log = new TestLog();

  // Check without waitUntil
  const toLog: Parameters<typeof logResponse>[1] = {
    start: process.hrtime(),
    startCpu: process.cpuUsage(),
    method: "GET",
    url: "http://localhost",
    status: 404,
  };
  await logResponse(log, toLog);
  let [level, message] = log.logs[0];
  t.is(level, LogLevel.NONE);
  t.regex(
    message,
    /GET http:\/\/localhost 404 Not Found \(\d+.\d{2}ms\) \(CPU: ~\d+.\d{2}ms\)/
  );

  // Check with waitUntil
  log.logs = [];
  toLog.waitUntil = Promise.all([Promise.resolve(42)]);
  await logResponse(log, toLog);
  [level, message] = log.logs[0];
  t.is(level, LogLevel.NONE);
  t.regex(
    message,
    /GET http:\/\/localhost 404 Not Found \(\d+.\d{2}ms, waitUntil: \d+.\d{2}ms\) \(CPU: ~\d+.\d{2}ms, waitUntil: ~\d+.\d{2}ms\)/
  );
});
