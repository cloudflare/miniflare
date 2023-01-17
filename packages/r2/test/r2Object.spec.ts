import assert from "assert";
import { Blob } from "buffer";
import crypto from "crypto";
import { ReadableStream, TextDecoderStream, TransformStream } from "stream/web";
import { TextEncoder } from "util";
import { MessageChannel } from "worker_threads";
import {
  Checksums,
  R2Checksums,
  R2Conditional,
  R2HTTPMetadata,
  R2Object,
  R2ObjectBody,
  R2ObjectMetadata,
  _valueToArray,
  createMD5Hash,
  createVersion,
  parseHttpMetadata,
  parseOnlyIf,
  parseR2ObjectMetadata,
  testR2Conditional,
} from "@miniflare/r2";
import { viewToBuffer } from "@miniflare/shared";
import { getObjectProperties, utf8Encode } from "@miniflare/shared-test";
import test from "ava";
import { Headers, Response } from "undici";

interface TestObject {
  a: string;
  b: number;
  c: boolean;
  d: null;
  e: object;
}

const encoder = new TextEncoder();

const uploaded = new Date();
const httpMetadata: R2HTTPMetadata = {
  contentType: "text/plain",
  contentLanguage: "en",
  contentDisposition: "inline",
  contentEncoding: "gzip",
  cacheControl: "public, max-age=31536000",
  cacheExpiry: new Date(uploaded.getTime() + 31_536_000 * 1_000),
};
const customMetadata = {
  foo: "bar",
  baz: "qux",
};
const metadata: R2ObjectMetadata = {
  key: "key",
  version: "version",
  size: 0,
  etag: "00000000000000000000000000000000",
  httpEtag: '"00000000000000000000000000000000"',
  uploaded,
  httpMetadata,
  customMetadata,
};

const r2Object = new R2Object(metadata);
const r2ObjectBody = new R2ObjectBody(metadata, new Uint8Array([0, 1, 2, 3]));

test("R2Object: R2Object: null throws error", (t) => {
  t.throws(() => {
    new R2Object(null as any);
  });
});
test("R2Object: R2ObjectBody: null throws error", (t) => {
  t.throws(() => {
    new R2Object(null as any);
  });
});

test("R2Object: R2Object: check values are stored correctly", (t) => {
  t.is(r2Object.key, "key");
  t.is(r2Object.version, "version");
  t.is(r2Object.size, 0);
  t.is(r2Object.etag, "00000000000000000000000000000000");
  t.is(r2Object.httpEtag, '"00000000000000000000000000000000"');
  t.is(r2Object.uploaded, uploaded);
  t.deepEqual(r2Object.httpMetadata, httpMetadata);
  t.deepEqual(r2Object.customMetadata, customMetadata);
});
test("R2Object: R2ObjectBody: check values are stored correctly", (t) => {
  t.is(r2ObjectBody.key, "key");
  t.is(r2ObjectBody.version, "version");
  t.is(r2ObjectBody.size, 0);
  t.is(r2ObjectBody.etag, "00000000000000000000000000000000");
  t.is(r2ObjectBody.httpEtag, '"00000000000000000000000000000000"');
  t.is(r2ObjectBody.uploaded, uploaded);
  t.deepEqual(r2ObjectBody.httpMetadata, httpMetadata);
  t.deepEqual(r2ObjectBody.customMetadata, customMetadata);
});

test("R2Object: R2Object: writeHttpMetadata works as intended", (t) => {
  const headers = new Headers();
  r2Object.writeHttpMetadata(headers);
  t.is(headers.get("content-type"), "text/plain");
  t.is(headers.get("content-language"), "en");
  t.is(headers.get("content-disposition"), "inline");
  t.is(headers.get("content-encoding"), "gzip");
  t.is(headers.get("cache-control"), "public, max-age=31536000");
  t.is(
    new Date(headers.get("cache-expiry") ?? 0).toUTCString(),
    r2Object.httpMetadata?.cacheExpiry?.toUTCString()
  );
});
test("R2Object: R2ObjectBody: writeHttpMetadata works as intended", (t) => {
  const headers = new Headers();
  r2ObjectBody.writeHttpMetadata(headers);
  t.is(headers.get("content-type"), "text/plain");
  t.is(headers.get("content-language"), "en");
  t.is(headers.get("content-disposition"), "inline");
  t.is(headers.get("content-encoding"), "gzip");
  t.is(headers.get("cache-control"), "public, max-age=31536000");
  t.is(
    new Date(headers.get("cache-expiry") ?? 0).toUTCString(),
    r2ObjectBody.httpMetadata?.cacheExpiry?.toUTCString()
  );
});

test("R2Object: R2ObjectBody: test bodyUsed", async (t) => {
  const text = "hello world";
  const body = new R2ObjectBody(metadata, await _valueToArray(text));
  await body.arrayBuffer();

  t.true(body.bodyUsed);
  await t.throwsAsync(body.arrayBuffer(), {
    instanceOf: Error,
    message: "Body already used.",
  });
});

test("R2Object: R2ObjectBody: test text", async (t) => {
  const text = "hello world";
  const body = new R2ObjectBody(metadata, await _valueToArray(text));
  const valueText = await body.text();

  t.is(valueText, text);
});

test("R2Object: R2ObjectBody: test array buffer", async (t) => {
  const text = "hello world";
  const uint8array = encoder.encode(text);
  const body = new R2ObjectBody(metadata, await _valueToArray(text));
  const valueArrayBuffer = await body.arrayBuffer();

  t.deepEqual(new Uint8Array(valueArrayBuffer), uint8array);
});

test("R2Object: R2ObjectBody: test blob", async (t) => {
  const text = "hello world";
  const uint8array = encoder.encode(text);
  const blob = new Blob([uint8array]);
  const body = new R2ObjectBody(metadata, await _valueToArray(text));
  const valueBlob = await body.blob();

  t.deepEqual(valueBlob, blob);
});

test("R2Object: R2ObjectBody: test JSON", async (t) => {
  const json: TestObject = {
    a: "a",
    b: 10,
    c: true,
    d: null,
    e: {},
  };
  const string = JSON.stringify(json);

  const body = new R2ObjectBody(metadata, await _valueToArray(string));
  const valueJSON = await body.json<TestObject>();

  t.deepEqual(valueJSON, json);
});

test("R2Object: R2ObjectBody: input is null", async (t) => {
  const body = new R2ObjectBody(metadata, await _valueToArray(null));
  const valueString = await body.text();

  t.is(valueString, "");
});

test("R2Object: R2ObjectBody: very large input is consumed as one piece.", async (t) => {
  const input = new Uint8Array(1_000_000);
  const body = new R2ObjectBody(metadata, await _valueToArray(input));
  const valueArrayBuffer = await body.arrayBuffer();
  const uint8array = new Uint8Array(valueArrayBuffer);

  t.deepEqual(uint8array, new Uint8Array(1_000_000));
});

test("R2Object: R2Object: correct object properties", (t) => {
  t.deepEqual(getObjectProperties(r2Object), [
    "checksums",
    "customMetadata",
    "etag",
    "httpEtag",
    "httpMetadata",
    "key",
    "range",
    "size",
    "uploaded",
    "version",
    "writeHttpMetadata",
  ]);
});

test("R2Object: R2ObjectBody: hides implementation details", (t) => {
  t.deepEqual(getObjectProperties(r2ObjectBody), [
    "arrayBuffer",
    "blob",
    "body",
    "bodyUsed",
    "customMetadata",
    "etag",
    "httpEtag",
    "httpMetadata",
    "json",
    "key",
    "range",
    "size",
    "text",
    "uploaded",
    "version",
    // "writeHttpMetadata", // TODO: Why is this function not exposed?
  ]);
});

test("R2Object: createHash", (t) => {
  const md5 = createMD5Hash(encoder.encode("hello world"));
  // pulled from https://www.md5hashgenerator.com/
  t.is(md5, "5eb63bbbe01eeed093cb22bb8f5acdc3");
});

test("R2Object: createVersion", (t) => {
  const version = createVersion();
  t.is(version.length, 32);
});

test("R2Object: parseHttpMetadata: undefined, and empty object return empty objects", (t) => {
  const undefinedMetadata = parseHttpMetadata();
  const emptyMetadata = parseHttpMetadata({});
  t.deepEqual(undefinedMetadata, {});
  t.deepEqual(emptyMetadata, {});
});

test("R2Object: parseHttpMetadata: each parameter is parsed correctly from R2HTTPMetadata object", (t) => {
  const cacheExpiry = new Date(0);
  const r2httpMetadata: R2HTTPMetadata = {
    contentType: "text/plain",
    contentLanguage: "en",
    contentDisposition: "inline",
    contentEncoding: "gzip",
    cacheControl: "public, max-age=31536000",
    cacheExpiry,
  };
  const parsedMetadata = parseHttpMetadata(r2httpMetadata);
  t.is(parsedMetadata.contentType, "text/plain");
  t.is(parsedMetadata.contentLanguage, "en");
  t.is(parsedMetadata.contentDisposition, "inline");
  t.is(parsedMetadata.contentEncoding, "gzip");
  t.is(parsedMetadata.cacheControl, "public, max-age=31536000");
  t.is(parsedMetadata.cacheExpiry, cacheExpiry);
});

test("R2Object: parseHttpMetadata: params outside R2HTTPMetadata are ignored", (t) => {
  const r2httpMetadata = {
    contentType: "text/plain",
    contentLanguage: "en",
    foo: "bar",
  };
  const parsedMetadata = parseHttpMetadata(r2httpMetadata);
  t.is(parsedMetadata.contentType, "text/plain");
  t.is(parsedMetadata.contentLanguage, "en");
  t.is((parsedMetadata as unknown as any).foo, undefined);
});

test("R2Object: parseHttpMetadata: parsing instanceof Headers", (t) => {
  const r2httpHeaders = new Headers();
  // test capitalization
  r2httpHeaders.append("Content-Type", "text/plain");
  // test case match
  r2httpHeaders.append("content-language", "en");
  const parsedMetadata = parseHttpMetadata(r2httpHeaders);
  t.is(parsedMetadata.contentType, "text/plain");
  t.is(parsedMetadata.contentLanguage, "en");
});

test("R2Object: testR2Conditional: no metadata", (t) => {
  // test metadata is undefined with no data
  t.true(testR2Conditional({}));
  // etagMatches exists with no metadata fails
  t.false(testR2Conditional({ etagMatches: "any" }));
  // uploadedAfter exists with no metadata fails
  t.false(testR2Conditional({ uploadedAfter: new Date() }));
  // etagDoesNotMatch exists with no metadata passes
  t.true(testR2Conditional({ etagDoesNotMatch: "any" }));
  // uploadedBefore exists with no metadata passes
  t.true(testR2Conditional({ uploadedBefore: new Date() }));
});

test("R2Object: testR2Conditional: test etagMatches", (t) => {
  // match
  const r2conditional: R2Conditional = {
    etagMatches: "00000000000000000000000000000000",
  };
  // no match
  const r2conditional2: R2Conditional = {
    etagMatches: "abc",
  };
  // none of many match
  const r2conditional3: R2Conditional = {
    etagMatches: ["abc", "def"],
  };
  // one of many exact match
  const r2conditional4: R2Conditional = {
    etagMatches: ["abc", "00000000000000000000000000000000"],
  };

  // match from above
  t.true(testR2Conditional(r2conditional, metadata));
  t.false(testR2Conditional(r2conditional2, metadata));
  t.false(testR2Conditional(r2conditional3, metadata));
  t.true(testR2Conditional(r2conditional4, metadata));
});

test("R2Object: testR2Conditional: test etagDoesNotMatch", (t) => {
  // no match
  const r2conditional: R2Conditional = {
    etagDoesNotMatch: "abc",
  };
  // none of many match
  const r2conditional2: R2Conditional = {
    etagDoesNotMatch: ["abc", "def"],
  };
  // one of many exact match
  const r2conditional3: R2Conditional = {
    etagDoesNotMatch: ["abc", "00000000000000000000000000000000"],
  };
  // exact match
  const r2conditional4: R2Conditional = {
    etagDoesNotMatch: "00000000000000000000000000000000",
  };

  t.true(testR2Conditional(r2conditional, metadata));
  t.true(testR2Conditional(r2conditional2, metadata));
  t.false(testR2Conditional(r2conditional3, metadata));
  t.false(testR2Conditional(r2conditional4, metadata));
});

test("R2Object: testR2Conditional: test uploadedBefore", (t) => {
  const r2conditional: R2Conditional = {
    uploadedBefore: new Date(100),
  };
  const r2conditional2: R2Conditional = {
    uploadedBefore: new Date(40),
  };
  const testMeta = JSON.parse(JSON.stringify(metadata)) as R2ObjectMetadata;
  testMeta.uploaded = new Date(80);

  t.true(testR2Conditional(r2conditional, testMeta));
  t.false(testR2Conditional(r2conditional2, testMeta));
});

test("R2Object: testR2Conditional: uploadedBefore is ignored if etagMatches matches metadata etag", (t) => {
  const r2conditional: R2Conditional = {
    uploadedBefore: new Date(40),
  };
  const r2conditional2: R2Conditional = {
    uploadedBefore: new Date(40),
    etagMatches: "00000000000000000000000000000000",
  };
  const testMeta = JSON.parse(JSON.stringify(metadata)) as R2ObjectMetadata;
  testMeta.uploaded = new Date(80);

  // fails without
  t.false(testR2Conditional(r2conditional, testMeta));
  // passes with
  t.true(testR2Conditional(r2conditional2, testMeta));
});

test("R2Object: testR2Conditional: test uploadedAfter", (t) => {
  const r2conditional: R2Conditional = {
    uploadedAfter: new Date(100),
  };
  const r2conditional2: R2Conditional = {
    uploadedAfter: new Date(40),
  };
  const testMeta = JSON.parse(JSON.stringify(metadata)) as R2ObjectMetadata;
  testMeta.uploaded = new Date(80);

  t.false(testR2Conditional(r2conditional, testMeta));
  t.true(testR2Conditional(r2conditional2, testMeta));
});

test("R2Object: testR2Conditional: uploadedAfter is ignored if etagDoesNotMatch does not match metadata etag", (t) => {
  const r2conditional: R2Conditional = {
    uploadedAfter: new Date(100),
  };
  const r2conditional2: R2Conditional = {
    uploadedAfter: new Date(100),
    etagDoesNotMatch: "nomatch",
  };
  const testMeta = JSON.parse(JSON.stringify(metadata)) as R2ObjectMetadata;
  testMeta.uploaded = new Date(80);

  // fails without
  t.false(testR2Conditional(r2conditional, testMeta));
  // passes with
  t.true(testR2Conditional(r2conditional2, testMeta));
});

test("R2Object: parseOnlyIf: undefined, and empty object return empty objects", (t) => {
  const undefinedMetadata = parseOnlyIf();
  const emptyMetadata = parseOnlyIf({});
  t.deepEqual(undefinedMetadata, {});
  t.deepEqual(emptyMetadata, {});
});

test("R2Object: parseOnlyIf: each parameter is parsed correctly as an R2Conditional object", (t) => {
  const r2conditional = {
    etagMatches: "*",
    etagDoesNotMatch: ["123", "456"],
    uploadedBefore: new Date(0),
    uploadedAfter: "1970-01-01T00:00:00.000Z",
  };
  const parsed = parseOnlyIf(r2conditional as any);
  t.is(parsed.etagMatches, "*");
  t.deepEqual(parsed.etagDoesNotMatch, ["123", "456"]);
  t.deepEqual(parsed.uploadedBefore, new Date(0));
  t.deepEqual(parsed.uploadedAfter, new Date(0));
});

test("R2Object: parseOnlyIf with quotes: each parameter is parsed correctly as an R2Conditional object", (t) => {
  const r2conditional = {
    etagMatches: '"*"',
    etagDoesNotMatch: ['"123"', '"456"'],
    uploadedBefore: '"1970-01-01T00:00:00.000Z"',
    uploadedAfter: '"1970-01-01T00:00:00.000Z"',
  };
  const parsed = parseOnlyIf(r2conditional as any);
  t.is(parsed.etagMatches, "*");
  t.deepEqual(parsed.etagDoesNotMatch, ["123", "456"]);
  t.deepEqual(parsed.uploadedBefore, new Date(0));
  t.deepEqual(parsed.uploadedAfter, new Date(0));
});

test("R2Object: parseOnlyIf: parsing instanceof Headers", (t) => {
  const r2ConditionalHeaders = new Headers();
  // test capitalization
  r2ConditionalHeaders.append("If-Match", "*");
  // test case match; also ensure whitespace is trimmed
  r2ConditionalHeaders.append("if-none-match", "123, 456");
  r2ConditionalHeaders.append(
    "if-Unmodified-since",
    "1970-01-01T00:00:00.000Z"
  );
  r2ConditionalHeaders.append("if-modified-since", "1970-01-01T00:00:00.000Z");

  const parsed = parseOnlyIf(r2ConditionalHeaders);
  t.is(parsed.etagMatches, "*");
  t.deepEqual(parsed.etagDoesNotMatch, ["123", "456"]);
  t.deepEqual(parsed.uploadedBefore, new Date(0));
  t.deepEqual(parsed.uploadedAfter, new Date(0));
});

test("R2Object: parseR2ObjectMetadata", (t) => {
  const metaClone = JSON.parse(JSON.stringify(metadata));
  // check that the metadata was modified from Date to string
  t.is(typeof metaClone.uploaded, "string");
  t.is(typeof metaClone.httpMetadata.cacheExpiry, "string");
  // parse the clone
  parseR2ObjectMetadata(metaClone);
  // now metaClone "uploaded" and "cacheExpiry" should be Date objects
  t.deepEqual(metaClone, metadata);
});

test("R2Object: R2ObjectBody: push 'body' ReadableStream to TransformStream", async (t) => {
  const r2ObjectBody = new R2ObjectBody(metadata, utf8Encode("test"));
  const { readable, writable } = new TransformStream();

  r2ObjectBody.body.pipeTo(writable);
  // convert readable to string
  const textStream = readable.pipeThrough(new TextDecoderStream());
  const reader = textStream.getReader();
  const { done, value } = await reader.read();
  t.false(done);
  t.is(value, "test");
  const { done: done2, value: value2 } = await reader.read();
  t.true(done2);
  t.is(value2, undefined);
});

test("R2Object: R2ObjectBody: push 'body' ReadableStream to Response", async (t) => {
  const r2ObjectBody = new R2ObjectBody(metadata, utf8Encode("test"));
  const { readable, writable } = new TransformStream();

  r2ObjectBody.body.pipeTo(writable);
  // convert readable to string
  const testResponse = new Response(readable);
  t.true(testResponse.body instanceof ReadableStream);
});

const bufferChecksums: R2Checksums<Buffer> = {
  md5: crypto.createHash("md5").update("test").digest(),
  sha1: crypto.createHash("sha1").update("test").digest(),
  sha256: crypto.createHash("sha256").update("test").digest(),
  sha384: crypto.createHash("sha384").update("test").digest(),
  sha512: crypto.createHash("sha512").update("test").digest(),
};
const stringChecksums: R2Checksums<string> = Object.fromEntries(
  Object.entries(bufferChecksums as { [key: string]: Buffer }).map(
    ([key, value]) => [key, value.toString("hex")]
  )
);
test("Checksums: returns `ArrayBuffer` hashes", async (t) => {
  const checksums = new Checksums(stringChecksums);
  t.deepEqual(checksums.md5, viewToBuffer(bufferChecksums.md5!));
  t.deepEqual(checksums.sha1, viewToBuffer(bufferChecksums.sha1!));
  t.deepEqual(checksums.sha256, viewToBuffer(bufferChecksums.sha256!));
  t.deepEqual(checksums.sha384, viewToBuffer(bufferChecksums.sha384!));
  t.deepEqual(checksums.sha512, viewToBuffer(bufferChecksums.sha512!));

  // Check getter returns new `ArrayBuffer` each time
  const buffer = checksums.md5;
  assert(buffer !== undefined);
  new MessageChannel().port1.postMessage(buffer, [buffer]);
  t.is(buffer.byteLength, 0); // (detached)
  t.is(checksums.md5?.byteLength, 16); // New buffer
});
test("Checksums: returns hex hashes with JSON.stringify()", async (t) => {
  const checksums = new Checksums(stringChecksums);
  t.deepEqual(checksums.toJSON(), stringChecksums);
  t.is(JSON.stringify(checksums), JSON.stringify(stringChecksums));
});
