import { Blob } from "buffer";
import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import { viewToArray } from "@miniflare/shared";
import { getObjectProperties } from "@miniflare/shared-test";
import test from "ava";
import { Headers } from "undici";
import { R2Conditional, R2PutValueType } from "../src/bucket";
import {
  R2HTTPMetadata,
  R2Object,
  R2ObjectBody,
  R2ObjectMetadata,
  createMD5,
  createVersion,
  parseHttpMetadata,
  parseOnlyIf,
  testR2Conditional,
} from "../src/r2Object";

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
  etag: "etag",
  httpEtag: "httpEtag",
  uploaded,
  httpMetadata,
  customMetadata,
};

const r2Object = new R2Object(metadata);
const r2ObjectBody = new R2ObjectBody(metadata, new Uint8Array([0, 1, 2, 3]));

const testValueMacro = async (value: R2PutValueType) => {
  let stored: Uint8Array;
  if (typeof value === "string") {
    stored = encoder.encode(value);
  } else if (value instanceof ReadableStream) {
    // @ts-expect-error @types/node stream/consumers doesn't accept ReadableStream
    stored = new Uint8Array(await arrayBuffer(value));
  } else if (value instanceof ArrayBuffer) {
    stored = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    stored = viewToArray(value);
  } else if (value === null) {
    stored = new Uint8Array();
  } else if (value instanceof Blob) {
    stored = new Uint8Array(await value.arrayBuffer());
  } else {
    throw new TypeError(
      "Accepts only nulls, strings, Blobs, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values."
    );
  }

  return new R2ObjectBody(metadata, stored);
};

test("R2Object: R2Object: null throws error", (t) => {
  t.throws(
    () => {
      new R2Object(null as any);
    },
    {
      instanceOf: Error,
      message: "Cannot read properties of null (reading 'key')",
    }
  );
});
test("R2Object: R2ObjectBody: null throws error", (t) => {
  t.throws(
    () => {
      new R2Object(null as any);
    },
    {
      instanceOf: Error,
      message: "Cannot read properties of null (reading 'key')",
    }
  );
});

test("R2Object: R2Object: check values are stored correctly", (t) => {
  t.is(r2Object.key, "key");
  t.is(r2Object.version, "version");
  t.is(r2Object.size, 0);
  t.is(r2Object.etag, "etag");
  t.is(r2Object.httpEtag, "httpEtag");
  t.is(r2Object.uploaded, uploaded);
  t.deepEqual(r2Object.httpMetadata, httpMetadata);
  t.deepEqual(r2Object.customMetadata, customMetadata);
});
test("R2Object: R2ObjectBody: check values are stored correctly", (t) => {
  t.is(r2ObjectBody.key, "key");
  t.is(r2ObjectBody.version, "version");
  t.is(r2ObjectBody.size, 0);
  t.is(r2ObjectBody.etag, "etag");
  t.is(r2ObjectBody.httpEtag, "httpEtag");
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

test("R2Object: R2ObjectBody: Test bodyUsed", async (t) => {
  const body = await testValueMacro("hello world");
  await body.arrayBuffer();

  t.true(body.bodyUsed);
  await t.throwsAsync(body.arrayBuffer(), {
    instanceOf: Error,
    message: "Body already used.",
  });
});

test("R2Object: R2ObjectBody: Test text", async (t) => {
  const text = "hello world";
  const body = await testValueMacro(text);
  const valueText = await body.text();

  t.is(valueText, text);
});

test("R2Object: R2ObjectBody: Test array buffer", async (t) => {
  const text = "hello world";
  const uint8array = encoder.encode(text);
  const body = await testValueMacro(text);
  const valueArrayBuffer = await body.arrayBuffer();

  t.deepEqual(new Uint8Array(valueArrayBuffer), uint8array);
});

test("R2Object: R2ObjectBody: Test blob", async (t) => {
  const text = "hello world";
  const uint8array = encoder.encode(text);
  const blob = new Blob([uint8array]);
  const body = await testValueMacro(text);
  const valueBlob = await body.blob();

  t.deepEqual(valueBlob, blob);
});

test("R2Object: R2ObjectBody: Test JSON", async (t) => {
  const json: TestObject = {
    a: "a",
    b: 10,
    c: true,
    d: null,
    e: {},
  };
  const string = JSON.stringify(json);

  const body = await testValueMacro(string);
  const valueJSON = await body.json<TestObject>();

  t.deepEqual(valueJSON, json);
});

test("R2Object: R2ObjectBody: input is null", async (t) => {
  const body = await testValueMacro(null);
  const valueString = await body.text();

  t.is(valueString, "");
});

test("R2Object: R2ObjectBody: Very large input is consumed as one piece.", async (t) => {
  const input = new Uint8Array(1_000_000);
  const body = await testValueMacro(input);
  const valueArrayBuffer = await body.arrayBuffer();
  const uint8array = new Uint8Array(valueArrayBuffer);

  t.deepEqual(uint8array, new Uint8Array(1_000_000));
});

test("R2Object: R2Object: Correct object properties", (t) => {
  t.deepEqual(getObjectProperties(r2Object), [
    "customMetadata",
    "etag",
    "httpEtag",
    "httpMetadata",
    "key",
    "size",
    "uploaded",
    "version",
    "writeHttpMetadata",
  ]);
});

test("R2Object: R2ObjectBody: Hides implementation details", (t) => {
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
    "size",
    "text",
    "uploaded",
    "version",
    // "writeHttpMetadata", // TODO: Why is this function not exposed?
  ]);
});

test("R2Object: createMD5", (t) => {
  const md5 = createMD5(encoder.encode("hello world"));
  // pulled from https://www.md5hashgenerator.com/
  t.is(md5, "5eb63bbbe01eeed093cb22bb8f5acdc3");
});

test("R2Object: createVersion", (t) => {
  const version = createVersion();
  t.is(version.length, 64);
});

test("R2Object: parseHttpMetadata: undefined, and empty object return empty objects", (t) => {
  const undefinedMetadata = parseHttpMetadata();
  const emptyMetadata = parseHttpMetadata({});
  t.deepEqual(undefinedMetadata, {});
  t.deepEqual(emptyMetadata, {});
});

test("R2Object: parseHttpMetadata: Each parameter is parsed correctly from R2HTTPMetadata object", (t) => {
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

test("R2Object: parseHttpMetadata: Params outside R2HTTPMetadata are ignored", (t) => {
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

test("R2Object: parseHttpMetadata: Parsing instanceof Headers", (t) => {
  const r2httpHeaders = new Headers();
  // test capitalization
  r2httpHeaders.append("Content-Type", "text/plain");
  // test case match
  r2httpHeaders.append("content-language", "en");
  const parsedMetadata = parseHttpMetadata(r2httpHeaders);
  t.is(parsedMetadata.contentType, "text/plain");
  t.is(parsedMetadata.contentLanguage, "en");
});

test("R2Object: testR2Conditional: Test etagMatches", (t) => {
  // wildcard match
  const r2conditional: R2Conditional = {
    etagMatches: "*",
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
    etagMatches: ["abc", "etag"],
  };
  // one of many matches
  const r2conditional5: R2Conditional = {
    etagMatches: ["abc", "*"],
  };
  // exact match
  const r2conditional6: R2Conditional = {
    etagMatches: "etag",
  };
  // partial match
  const r2conditional7: R2Conditional = {
    etagMatches: "*tag",
  };

  t.true(testR2Conditional(r2conditional, metadata));
  t.false(testR2Conditional(r2conditional2, metadata));
  t.false(testR2Conditional(r2conditional3, metadata));
  t.true(testR2Conditional(r2conditional4, metadata));
  t.true(testR2Conditional(r2conditional5, metadata));
  t.true(testR2Conditional(r2conditional6, metadata));
  t.true(testR2Conditional(r2conditional7, metadata));
});

test("R2Object: testR2Conditional: Test etagDoesNotMatch", (t) => {
  // wildcard match
  const r2conditional: R2Conditional = {
    etagDoesNotMatch: "*",
  };
  // no match
  const r2conditional2: R2Conditional = {
    etagDoesNotMatch: "abc",
  };
  // none of many match
  const r2conditional3: R2Conditional = {
    etagDoesNotMatch: ["abc", "def"],
  };
  // one of many exact match
  const r2conditional4: R2Conditional = {
    etagDoesNotMatch: ["abc", "etag"],
  };
  // one of many matches
  const r2conditional5: R2Conditional = {
    etagDoesNotMatch: ["abc", "*"],
  };
  // exact match
  const r2conditional6: R2Conditional = {
    etagDoesNotMatch: "etag",
  };
  // partial match
  const r2conditional7: R2Conditional = {
    etagDoesNotMatch: "*tag",
  };

  t.false(testR2Conditional(r2conditional, metadata));
  t.true(testR2Conditional(r2conditional2, metadata));
  t.true(testR2Conditional(r2conditional3, metadata));
  t.false(testR2Conditional(r2conditional4, metadata));
  t.false(testR2Conditional(r2conditional5, metadata));
  t.false(testR2Conditional(r2conditional6, metadata));
  t.false(testR2Conditional(r2conditional7, metadata));
});

test("R2Object: testR2Conditional: Test uploadedBefore", (t) => {
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

test("R2Object: testR2Conditional: Test uploadedAfter", (t) => {
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

test("R2Object: parseOnlyIf: undefined, and empty object return empty objects", (t) => {
  const undefinedMetadata = parseOnlyIf();
  const emptyMetadata = parseOnlyIf({});
  t.deepEqual(undefinedMetadata, {});
  t.deepEqual(emptyMetadata, {});
});

test("R2Object: parseOnlyIf: Each parameter is parsed correctly as an R2Conditional object", (t) => {
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

test("R2Object: parseOnlyIf: Parsing instanceof Headers", (t) => {
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
