import assert from "assert";
import { Blob } from "buffer";
import fs from "fs/promises";
import path from "path";
import { ReadableStream } from "stream/web";
import {
  R2Bucket,
  R2HTTPMetadata,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2ObjectMetadata,
  R2Objects,
  R2PutOptions,
  R2PutValueType,
  createHash,
  parseR2ObjectMetadata,
} from "@miniflare/r2";
import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  RequestContextOptions,
  Storage,
  StoredValueMeta,
  base64Encode,
  sanitisePath,
} from "@miniflare/shared";
import {
  TestStorageFactory,
  advancesTime,
  getObjectProperties,
  storageMacros,
  testClock,
  useTmp,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import { FileStorage } from "@miniflare/storage-file";
import anyTest, {
  ExecutionContext,
  Macro,
  TestInterface,
  ThrowsExpectation,
} from "ava";
import { Headers } from "undici";

const requestCtxOptions: RequestContextOptions = {
  externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
};

interface Context {
  storage: Storage;
  r2: R2Bucket;
}

interface TestR2ObjectMetadata {
  key: string;
  size?: number;
  etag?: string;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

class FileStorageFactory extends TestStorageFactory {
  name = "FileStorage";

  async factory(
    t: ExecutionContext,
    seed: Record<string, StoredValueMeta>
  ): Promise<Storage> {
    const tmp = await useTmp(t);
    for (const [key, { value, expiration, metadata }] of Object.entries(seed)) {
      await fs.mkdir(path.dirname(path.join(tmp, key)), { recursive: true });
      await fs.writeFile(path.join(tmp, key), value);
      if (expiration || metadata || key !== sanitisePath(key)) {
        await fs.writeFile(
          path.join(tmp, key + ".meta.json"),
          JSON.stringify({ expiration, metadata, key }),
          "utf8"
        );
      }
    }
    return new FileStorage(tmp, true, testClock);
  }
}

const test = anyTest as TestInterface<Context>;

const storageFactory = new FileStorageFactory();
for (const macro of storageMacros) {
  test(macro, storageFactory);
}

test.beforeEach(async (t) => {
  const storage = await storageFactory.factory(t, {});
  const r2 = new R2Bucket(storage);
  t.context = { storage, r2 };
});

const validatesKeyMacro: Macro<
  [
    method: string,
    httpMethod: string,
    func: (r2: R2Bucket, key?: any) => Promise<void>
  ],
  Context
> = async (t, method, httpMethod, func) => {
  const { r2 } = t.context;
  await t.throwsAsync(func(r2), {
    instanceOf: TypeError,
    message: `Failed to execute '${method}' on 'R2Bucket': parameter 1 is not of type 'string'.`,
  });
  await t.throwsAsync(func(r2, 0), {
    instanceOf: TypeError,
    message: `Failed to execute '${method}' on 'R2Bucket': parameter 1 is not of type 'string'.`,
  });
  await t.throwsAsync(func(r2, String.fromCharCode(parseInt("D801", 16))), {
    message: `R2 ${method.toUpperCase()} failed: (400) Key contains an illegal unicode value(s).`,
  });
  await t.throwsAsync(func(r2, String.fromCharCode(parseInt("DC01", 16))), {
    message: `R2 ${method.toUpperCase()} failed: (400) Key contains an illegal unicode value(s).`,
  });
  await t.throwsAsync(func(r2, "".padStart(1025, "x")), {
    instanceOf: Error,
    message: `R2 ${httpMethod} failed: (414) UTF-8 encoded length of 1025 exceeds key length limit of 1024.`,
  });
};
validatesKeyMacro.title = (providedTitle, method) => `${method}: validates key`;

test("head: returns null for non-existent keys", async (t) => {
  const { r2 } = t.context;
  t.is(await r2.head("key"), null);
});
test("head: increments subrequest count", async (t) => {
  const { r2 } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => r2.head("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("head: waits for input gate to open before returning", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  await waitsForInputGate(t, () => r2.head("key"));
});
test("head: waits for input gate to open before returning with non-existent key", async (t) => {
  const { r2 } = t.context;
  await waitsForInputGate(t, () => r2.head("key"));
});
test("head: waits for input gate to open before returning value", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2Object = await waitsForInputGate(t, () => r2.head("key"));
  const etag = createHash(utf8Encode("value"));
  assert(r2Object);
  t.is(r2Object.key, "key");
  t.is(r2Object.size, "value".length);
  t.is(r2Object.etag, etag);
  t.is(r2Object.httpEtag, `"${etag}"`);
  t.deepEqual(r2Object.httpMetadata, {});
  t.deepEqual(r2Object.customMetadata, {});
  t.true(r2Object.uploaded instanceof Date);
});
test(validatesKeyMacro, "head", "HEAD", async (r2, key) => {
  await r2.head(key);
});

test("get: returns null for non-existent keys", async (t) => {
  const { r2 } = t.context;
  t.is(await r2.get("key"), null);
});
test("get: increments subrequest count", async (t) => {
  const { r2 } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => r2.get("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("get: waits for input gate to open before returning", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  await waitsForInputGate(t, () => r2.get("key"));
});
test("get: waits for input gate to open before returning with non-existent key", async (t) => {
  const { r2 } = t.context;
  await waitsForInputGate(t, () => r2.get("key"));
});
test("get: waits for input gate to open before returning value", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await waitsForInputGate(t, () => r2.get("key"));
  assert(r2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test(validatesKeyMacro, "get", "GET", async (r2, key) => {
  await r2.get(key);
});
test("get: range using offset", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", { range: { offset: 3 } });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "ue");
});
test("get: range using length", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", { range: { length: 3 } });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "val");
});
test("get: range using offset and length", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", { range: { offset: 1, length: 3 } });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "alu");
});
test("get: range using suffix", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", { range: { suffix: 3 } });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "lue");
});
test("get: offset is NaN", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { range: { offset: "nan" } as any }),
    {
      message:
        "R2 GET failed: (400) offset must either be a number or undefined.",
    }
  );
});
test("get: length is NaN", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { range: { length: "nan" } as any }),
    {
      message:
        "R2 GET failed: (400) length must either be a number or undefined.",
    }
  );
});
test("get: suffix is NaN", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { range: { suffix: "nan" } as any }),
    {
      message:
        "R2 GET failed: (400) suffix must either be a number or undefined.",
    }
  );
});

test("get: onlyIf: etagMatches as a string passes", async (t) => {
  const { r2 } = t.context;
  const etag = createHash(utf8Encode("value"));
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", { onlyIf: { etagMatches: etag } });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagMatches as a Header passes", async (t) => {
  const { r2 } = t.context;
  const headers = new Headers();
  const etag = createHash(utf8Encode("value"));
  headers.append("if-match", etag);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagMatches as a string array passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const etag = createHash(utf8Encode("value"));
  const r2ObjectBody = await r2.get("key", {
    onlyIf: { etagMatches: [etag, "etag2"] },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagMatches as a headers array passes", async (t) => {
  const { r2 } = t.context;
  const headers = new Headers();
  const etag = createHash(utf8Encode("value"));
  headers.append("if-match", `${etag}, etag2`);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});

test("get: onlyIf: etagDoesNotMatch as a string passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: { etagDoesNotMatch: "no match" },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagDoesNotMatch as a Header string passes", async (t) => {
  const { r2 } = t.context;
  const headers = new Headers();
  headers.append("if-none-match", "fail");
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagDoesNotMatch as a string array passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: { etagDoesNotMatch: ["fail1", "fail2"] },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: etagDoesNotMatch as a headers array passes", async (t) => {
  const { r2 } = t.context;
  const headers = new Headers();
  headers.append("if-none-match", "fail1, fail2");
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});

test("get: onlyIf: uploadedBefore as a date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: { uploadedBefore: date },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedBefore as a headers date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedBefore as a date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value");
  const r2Object = await r2.get("key", {
    onlyIf: { uploadedBefore: date },
  });
  assert(r2Object instanceof R2Object);
  t.false(r2Object instanceof R2ObjectBody);
  t.is(r2Object.key, "key");
});
test("get: onlyIf: uploadedBefore as a headers date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  await r2.put("key", "value");
  const r2Object = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2Object instanceof R2Object);
  t.false(r2Object instanceof R2ObjectBody);
  t.is(r2Object.key, "key");
});
test("get: onlyIf: uploadedBefore as a date is ignored if etagMatches matches metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: {
      uploadedBefore: date,
      etagMatches: createHash(utf8Encode("value")),
    },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedBefore as a headers date is ignored if etagMatches matches metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  headers.append("if-match", createHash(utf8Encode("value")));
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});

test("get: onlyIf: uploadedAfter as a date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: { uploadedAfter: date },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedAfter as a headers date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toUTCString());
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedAfter as a date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value");
  const r2Object = await r2.get("key", {
    onlyIf: { uploadedAfter: date },
  });
  assert(r2Object instanceof R2Object);
  t.false(r2Object instanceof R2ObjectBody);
  t.is(r2Object.key, "key");
});
test("get: onlyIf: uploadedAfter as a headers date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toString());
  await r2.put("key", "value");
  const r2Object = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2Object instanceof R2Object);
  t.false(r2Object instanceof R2ObjectBody);
  t.is(r2Object.key, "key");
});
test("get: onlyIf: uploadedAfter as a date is ignored if etagDoesNotMatch passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: {
      uploadedAfter: date,
      etagDoesNotMatch: "fail",
    },
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});
test("get: onlyIf: uploadedAfter as a headers date is ignored if etagDoesNotMatch passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toString());
  headers.append("if-none-match", "fail");
  await r2.put("key", "value");
  const r2ObjectBody = await r2.get("key", {
    onlyIf: headers,
  });
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value");
});

test("get: onlyIf: fails if not Headers, object, or undefined", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { onlyIf: "string" as any }),
    {
      message:
        "R2 GET failed: (400) onlyIf must be an object, a Headers instance, or undefined.",
    }
  );
});
test("get: onlyIf: etagMatches: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { onlyIf: { etagMatches: 1 } as any }),
    {
      message: "R2 GET failed: (400) etagMatches must be a string.",
    }
  );
});
test("get: onlyIf: etagDoesNotMatch: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { onlyIf: { etagDoesNotMatch: 1 } as any }),
    {
      message: "R2 GET failed: (400) etagDoesNotMatch must be a string.",
    }
  );
});
test("get: onlyIf: uploadedBefore: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { onlyIf: { uploadedBefore: 1 } as any }),
    {
      message: "R2 GET failed: (400) uploadedBefore must be a Date.",
    }
  );
});
test("get: onlyIf: uploadedAfter: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.get("key", { onlyIf: { uploadedAfter: 1 } as any }),
    {
      message: "R2 GET failed: (400) uploadedAfter must be a Date.",
    }
  );
});

const putMacro: Macro<
  [
    {
      key: string;
      value: R2PutValueType;
      options?: R2PutOptions;
      expected: StoredValueMeta;
      expectedHttpMetadata?: R2HTTPMetadata;
    }
  ],
  Context
> = async (t, { key, value, options, expected, expectedHttpMetadata }) => {
  const { storage, r2 } = t.context;
  await r2.put(key, value, options);

  const get = await storage.get<R2ObjectMetadata>(key);
  const metadata = get?.metadata;

  assert(get);
  assert(metadata);
  parseR2ObjectMetadata(metadata);

  const etag = createHash(get.value);

  t.is(key, metadata.key);
  t.is(typeof metadata.version, "string");
  t.is(metadata.version.length, 32);
  t.is(metadata.size, get.value.length);
  t.is(metadata.etag, etag);
  t.is(metadata.httpEtag, `"${etag}"`);
  // Date.parse returns NaN if parsing fails.
  t.true(metadata.uploaded instanceof Date);
  t.deepEqual(
    metadata.httpMetadata,
    expectedHttpMetadata ?? options?.httpMetadata ?? {}
  );
  t.deepEqual(metadata.customMetadata, options?.customMetadata ?? {});
  t.deepEqual(get.value, expected.value);
  t.is(get.expiration, undefined);
};
putMacro.title = (providedTitle) => `put: puts ${providedTitle}`;
test("text", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
});
test("streams", putMacro, {
  key: "stream",
  value: new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("array buffers", putMacro, {
  key: "arrayBuffer",
  value: new Uint8Array([1, 2, 3]).buffer,
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("array buffer views", putMacro, {
  key: "arrayBufferView",
  value: new DataView(new Uint8Array([1, 2, 3]).buffer),
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("blobs", putMacro, {
  key: "blob",
  value: new Blob([new Uint8Array([1, 2, 3])]),
  expected: { value: new Uint8Array([1, 2, 3]) },
});
test("null", putMacro, {
  key: "null",
  value: null,
  expected: { value: new Uint8Array([]) },
});
test("with httpMetadata option as object", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
  options: {
    httpMetadata: {
      contentType: "text/plain",
      contentEncoding: "utf-8",
      contentLanguage: "en",
      contentDisposition: "inline",
      cacheControl: "max-age=3600",
      cacheExpiry: new Date("Fri, 01 Jan 2020 00:00:00 GMT"),
    },
  },
});
const buildHTTPMetadata = (): Headers => {
  const metadata = new Headers();
  metadata.set("Content-Type", "text/plain");
  metadata.set("content-encoding", "utf-8");
  metadata.set("content-language", "en");
  metadata.set("content-disposition", "inline");
  metadata.set("cache-control", "max-age=3600");
  metadata.set("Cache-Expiry", "Fri, 01 Jan 2020 00:00:00 GMT");
  return metadata;
};
test("with httpMetadata option as Header", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
  options: {
    httpMetadata: buildHTTPMetadata(),
  },
  expectedHttpMetadata: {
    contentType: "text/plain",
    contentEncoding: "utf-8",
    contentLanguage: "en",
    contentDisposition: "inline",
    cacheControl: "max-age=3600",
    cacheExpiry: new Date("Fri, 01 Jan 2020 00:00:00 GMT"),
  },
});
test("with customMetadata option", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
  options: {
    customMetadata: {
      foo: "bar",
      baz: "qux",
    },
  },
});
test("with md5 as correct string", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
  options: {
    md5: createHash(utf8Encode("value")),
  },
});
const md5ToBuffer = (input: string): ArrayBuffer => {
  const buffer = new ArrayBuffer(input.length / 2);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < input.length; i += 2) {
    view[i / 2] = parseInt(input.slice(i, i + 2), 16);
  }
  return buffer;
};

test("with md5 as correct arrayBuffer", putMacro, {
  key: "text",
  value: "value",
  expected: { value: utf8Encode("value") },
  options: {
    md5: md5ToBuffer(createHash(utf8Encode("value"))),
  },
});
test("put: md5 not a string or arrayBuffer", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.put("key", "value", { md5: 5 as unknown as any }),
    {
      message:
        "R2 PUT failed: (400) md5 must be a string, ArrayBuffer, or undefined.",
    }
  );
});
test("put: bad md5 string fails", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.put("key", "value", { md5: "bad" }),
    {
      message:
        "R2 PUT failed: (400) The Content-MD5 you specified did not match what we received.",
    }
  );
});
test("put: bad md5 arrayBuffer fails", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.put("key", "value", { md5: new ArrayBuffer(0) }),
    {
      message:
        "R2 PUT failed: (400) The Content-MD5 you specified did not match what we received.",
    }
  );
});
test("put: httpMetadata that uses a key not in R2HttpMetadata is filtered", async (t) => {
  const { r2 } = t.context;
  const putRes = await r2.put("key", "value", {
    httpMetadata: { contentType: "json", foo: "bar" } as any,
  });
  assert(putRes);
  t.is(putRes.key, "key");
  t.not((putRes.httpMetadata as any).foo, "bar");
  t.is(putRes.httpMetadata.contentType, "json");
});
test("put: bad customMetadata fails", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", { customMetadata: { foo: 1 } as any }),
    {
      message: "R2 PUT failed: (400) customMetadata values must be strings.",
    }
  );
});
test("put: increments subrequest count", async (t) => {
  const { r2 } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => r2.put("key", "value"));
  t.is(ctx.internalSubrequests, 1);
});
test("put: waits for output gate to open before storing", async (t) => {
  const { r2 } = t.context;
  await waitsForOutputGate(
    t,
    () => r2.put("key", "value"),
    () => r2.get("key")
  );
});
test("put: waits for input gate to open before returning", async (t) => {
  const { r2 } = t.context;
  await waitsForInputGate(t, () => r2.put("key", "value"));
});
test(validatesKeyMacro, "put", "PUT", async (r2, key) => {
  await r2.put(key, "value");
});
test("put: validates value type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.put("key", new Map() as any), {
    instanceOf: TypeError,
    message:
      "R2 put() accepts only nulls, strings, Blobs, ArrayBuffers, ArrayBufferViews, and ReadableStreams as values.",
  });
});

test("put: onlyIf: etagMatches as a string passes", async (t) => {
  const { r2 } = t.context;
  const etag = createHash(utf8Encode("value1"));
  const etag2 = createHash(utf8Encode("value2"));
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: { etagMatches: etag },
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  t.is(putRes.etag, etag2);
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagMatches as a Header passes", async (t) => {
  const { r2 } = t.context;
  const headers = new Headers();
  const etag = createHash(utf8Encode("value1"));
  const etag2 = createHash(utf8Encode("value2"));
  headers.append("if-match", etag);
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: headers,
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  t.is(putRes.etag, etag2);
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagMatches as a string array passes", async (t) => {
  const { r2 } = t.context;
  const etag = createHash(utf8Encode("value1"));
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: { etagMatches: [etag, "etag2"] },
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagMatches as a headers array passes", async (t) => {
  const { r2 } = t.context;
  const etag = createHash(utf8Encode("value1"));
  const headers = new Headers();
  headers.append("if-match", `${etag}, etag2`);
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: headers,
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});

test("put: onlyIf: etagDoesNotMatch as a string passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: { etagDoesNotMatch: "no match" },
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagDoesNotMatch as a Header string passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value1");
  const headers = new Headers();
  headers.append("if-none-match", "fail");
  const putRes = await r2.put("key", "value2", {
    onlyIf: headers,
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagDoesNotMatch as a string array passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value1");
  const putRes = await r2.put("key", "value2", {
    onlyIf: { etagDoesNotMatch: ["fail1", "fail2"] },
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: etagDoesNotMatch as a headers array passes", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value1");
  const headers = new Headers();
  headers.append("if-none-match", "fail1, fail2");
  const putRes = await r2.put("key", "value2", {
    onlyIf: headers,
  });
  assert(putRes instanceof R2Object);
  t.is(putRes.key, "key");
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});

test("put: onlyIf: uploadedBefore as a date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: { uploadedBefore: date },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedBefore as a headers date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedBefore as a date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: { uploadedBefore: date },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value1");
});
test("put: onlyIf: uploadedBefore as a headers date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value1");
});
test("put: onlyIf: uploadedBefore as a date is ignored if etagMatches matches metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: {
      uploadedBefore: date,
      etagMatches: createHash(utf8Encode("value1")),
    },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedBefore as a headers date if etagMatches matches metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-unmodified-since", date.toUTCString());
  headers.append("if-match", createHash(utf8Encode("value1")));
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});

test("put: onlyIf: uploadedAfter as a date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: { uploadedAfter: date },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedAfter as a headers date passes", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() - 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toUTCString());
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedAfter as a date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: { uploadedAfter: date },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value1");
});
test("put: onlyIf: uploadedAfter as a headers date fails", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toUTCString());
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value1");
});
test("put: onlyIf: uploadedAfter as a date is ignored if etagDoesNotMatch does not match metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: {
      uploadedAfter: date,
      etagDoesNotMatch: createHash(utf8Encode("nomatch")),
    },
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});
test("put: onlyIf: uploadedAfter as a headers date is ignored if etagDoesNotMatch does not match metadata etag", async (t) => {
  const { r2 } = t.context;
  const date = new Date(Date.now() + 50_000);
  const headers = new Headers();
  headers.append("if-modified-since", date.toUTCString());
  headers.append("if-none-match", createHash(utf8Encode("nomatch")));
  await r2.put("key", "value1");
  await r2.put("key", "value2", {
    onlyIf: headers,
  });
  const r2ObjectBody = await r2.get("key");
  assert(r2ObjectBody instanceof R2ObjectBody);
  t.is(await r2ObjectBody.text(), "value2");
});

test("put: onlyIf: fails if not Headers, object, or undefined", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () => await r2.put("key", "value", { onlyIf: "string" as any }),
    {
      message:
        "R2 PUT failed: (400) onlyIf must be an object, a Headers instance, or undefined.",
    }
  );
});
test("put: onlyIf: etagMatches: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", { onlyIf: { etagMatches: 1 } as any }),
    {
      message: "R2 PUT failed: (400) etagMatches must be a string.",
    }
  );
});
test("put: onlyIf: etagDoesNotMatch: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", { onlyIf: { etagDoesNotMatch: 1 } as any }),
    {
      message: "R2 PUT failed: (400) etagDoesNotMatch must be a string.",
    }
  );
});
test("put: onlyIf: uploadedBefore: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", { onlyIf: { uploadedBefore: 1 } as any }),
    {
      message: "R2 PUT failed: (400) uploadedBefore must be a Date.",
    }
  );
});
test("put: onlyIf: uploadedAfter: fails if bad type", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", { onlyIf: { uploadedAfter: 1 } as any }),
    {
      message: "R2 PUT failed: (400) uploadedAfter must be a Date.",
    }
  );
});

test("put: httpMetadata: must be an object or undefined", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", {
        httpMetadata: "bad" as any,
      }),
    {
      message:
        "R2 PUT failed: (400) httpMetadata must be an object or undefined.",
    }
  );
});
test("put: httpMetadata: cacheExpirey must be a Date or undefined", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", {
        httpMetadata: { cacheExpirey: 1 } as any,
      }),
    {
      message:
        "R2 PUT failed: (400) cacheExpirey's value must be a string or undefined.",
    }
  );
});
test("put: customMetadata: must be an object or undefined", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(
    async () =>
      await r2.put("key", "value", {
        customMetadata: "bad" as any,
      }),
    {
      message:
        "R2 PUT failed: (400) customMetadata must be an object or undefined.",
    }
  );
});

test("delete: deletes existing keys", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  t.not(await r2.get("key"), null);
  await r2.delete("key");
  t.is(await r2.get("key"), null);
});
test("delete: does nothing for non-existent keys", async (t) => {
  const { r2 } = t.context;
  await r2.delete("key");
  t.pass();
});
test("delete: increments subrequest count", async (t) => {
  const { r2 } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => r2.delete("key"));
  t.is(ctx.internalSubrequests, 1);
});
test("delete: waits for output gate to open before deleting", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  await waitsForOutputGate(
    t,
    () => r2.delete("key"),
    async () => !(await r2.get("key"))
  );
});
test("delete: waits for input gate to open before returning", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  await waitsForInputGate(t, () => r2.delete("key"));
});
test(validatesKeyMacro, "delete", "DELETE", async (r2, key) => {
  await r2.delete(key);
});

const listMacro: Macro<
  [
    {
      values: Record<string, string>;
      options?: R2ListOptions;
      objects: TestR2ObjectMetadata[][];
      delimitedPrefixes?: string[];
    }
  ],
  Context
> = async (
  t,
  {
    values,
    options = {},
    objects: expectedObjects,
    delimitedPrefixes: expectedDP = [],
  }
) => {
  const { r2 } = t.context;
  // first store all the values
  for (const [key, value] of Object.entries(values)) {
    await r2.put(key, value);
  }

  let lastCursor: string | undefined;
  for (let i = 0; i < expectedObjects.length; i++) {
    // grab the expected object
    const expectedObject = expectedObjects[i];
    // grab the list of keys in expectedObject (use first object as a template)
    const expectedKeys = new Set(
      expectedObject.length > 0 ? Object.keys(expectedObject[0]) : []
    );
    // run the list call
    const { cursor, objects, truncated, delimitedPrefixes } = (await r2.list({
      prefix: options.prefix,
      limit: options.limit,
      cursor: options.cursor ?? lastCursor,
    })) as R2Objects;
    // pull in the details from said list
    t.deepEqual(
      objects.map((o) => {
        const res: { [key: string]: any } = {};
        for (const k of Object.keys(o)) {
          if (expectedKeys.has(k)) res[k] = o[k as keyof TestR2ObjectMetadata];
        }
        return res;
      }) as TestR2ObjectMetadata[],
      expectedObject
    );
    // figure out the limit. truncated and cursor will exist if the limit was matched/exceeded
    if (cursor !== undefined && cursor.length > 0) {
      t.true(truncated);
    } else {
      t.false(truncated);
    }
    t.deepEqual(delimitedPrefixes, expectedDP);
    lastCursor = cursor;
  }
};
listMacro.title = (providedTitle) => `list: ${providedTitle}`;
test("lists keys in sorted order", listMacro, {
  values: {
    key3: "value3",
    key1: "value1",
    key2: "value2",
  },
  objects: [[{ key: "key1" }, { key: "key2" }, { key: "key3" }]],
});
test("lists keys matching prefix", listMacro, {
  values: {
    section1key1: "value11",
    section1key2: "value12",
    section2key1: "value21",
  },
  options: { prefix: "section1" },
  objects: [[{ key: "section1key1" }, { key: "section1key2" }]],
});
test("returns an empty list with no keys", listMacro, {
  values: {},
  objects: [[]],
});
test("returns an empty list with no matching keys", listMacro, {
  values: {
    key1: "value1",
    key2: "value2",
    key3: "value3",
  },
  options: { prefix: "none" },
  objects: [[]],
});
test("returns an empty list with an invalid cursor", listMacro, {
  values: {
    key1: "value1",
    key2: "value2",
    key3: "value3",
  },
  options: { cursor: base64Encode("bad") },
  objects: [[]],
});
test("paginates keys", listMacro, {
  values: {
    key1: "value1",
    key2: "value2",
    key3: "value3",
  },
  options: { limit: 2 },
  objects: [[{ key: "key1" }, { key: "key2" }], [{ key: "key3" }]],
});
test("paginates keys matching prefix", listMacro, {
  values: {
    section1key1: "value11",
    section1key2: "value12",
    section1key3: "value13",
    section2key1: "value21",
  },
  options: { prefix: "section1", limit: 2 },
  objects: [
    [{ key: "section1key1" }, { key: "section1key2" }],
    [{ key: "section1key3" }],
  ],
});

const testEqualityMacro = async (
  t: ExecutionContext<Context>,
  objects: R2Object[],
  expectedObjects: TestR2ObjectMetadata[]
): Promise<void> => {
  // grab the list of keys in expectedObject (use first object as a template)
  const expectedKeys = new Set(
    expectedObjects.length > 0 ? Object.keys(expectedObjects[0]) : []
  );
  // test the equality of the objects
  t.deepEqual(
    objects.map((o) => {
      const res: { [key: string]: any } = {};
      for (const k of Object.keys(o)) {
        if (expectedKeys.has(k)) res[k] = o[k as keyof TestR2ObjectMetadata];
      }
      return res;
    }) as TestR2ObjectMetadata[],
    expectedObjects
  );
};

test("list: paginates with variable limit", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1");
  await r2.put("key2", "value2");
  await r2.put("key3", "value3");

  // Get first page
  let page = await r2.list({ limit: 1 });
  testEqualityMacro(t, page.objects, [{ key: "key1" }]);
  t.true(page.truncated);
  t.not(page.cursor, "");

  // Get second page with different limit
  page = await r2.list({ limit: 2, cursor: page.cursor });
  testEqualityMacro(t, page.objects, [{ key: "key2" }, { key: "key3" }]);
  t.false(page.truncated);
  t.is(page.cursor, undefined);
});
test("list: returns keys inserted whilst paginating", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1");
  await r2.put("key3", "value3");
  await r2.put("key5", "value5");

  // Get first page
  let page = await r2.list({ limit: 2 });
  testEqualityMacro(t, page.objects, [{ key: "key1" }, { key: "key3" }]);
  t.true(page.truncated);
  t.not(page.cursor, "");

  // Insert key2 and key4
  await r2.put("key2", "value2");
  await r2.put("key4", "value4");

  // Get second page, expecting to see key4 but not key2
  page = await r2.list({ limit: 2, cursor: page.cursor });
  testEqualityMacro(t, page.objects, [{ key: "key4" }, { key: "key5" }]);
  t.false(page.truncated);
  t.is(page.cursor, undefined);
});
test("list: sorts lexicographically", async (t) => {
  const { r2 } = t.context;
  await r2.put(", ", "value");
  await r2.put("!", "value");

  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list();
  t.is(objects[0].key, "!");
  t.is(objects[1].key, ", ");
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});
test("list: increments subrequest count", async (t) => {
  const { r2 } = t.context;
  const ctx = new RequestContext(requestCtxOptions);
  await ctx.runWith(() => r2.list());
  t.is(ctx.internalSubrequests, 1);
});
test("list: waits for input gate to open before returning", async (t) => {
  const { r2 } = t.context;
  await r2.put("key", "value");
  await waitsForInputGate(t, () => r2.list());
});
test("list: validates limit", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ limit: "nan" as any }), {
    instanceOf: Error,
    message: "R2 LIST failed: (400) limit must be a number or undefined.",
  });
  await t.throwsAsync(r2.list({ limit: 0 }), {
    instanceOf: Error,
    message:
      "R2 LIST failed: (400) MaxKeys params must be positive integer <= 1000.",
  });
  await t.throwsAsync(r2.list({ limit: 1_001 }), {
    instanceOf: Error,
    message:
      "R2 LIST failed: (400) MaxKeys params must be positive integer <= 1000.",
  });
});

test("list: httpMetadata: not included in options returns empty metadata", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1", { httpMetadata: { contentEncoding: "gzip" } });
  await r2.put("key2", "value2", { httpMetadata: { contentType: "dinosaur" } });
  await r2.put("key3", "value3", { httpMetadata: { contentLanguage: "en" } });
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    include: [],
  });

  const metadatas = objects.map((o) => o.httpMetadata);
  t.deepEqual(metadatas, [{}, {}, {}]);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});
test("list: httpMetadata: included in options returns metadata", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1", { httpMetadata: { contentEncoding: "gzip" } });
  await r2.put("key2", "value2", { httpMetadata: { contentType: "dinosaur" } });
  await r2.put("key3", "value3", { httpMetadata: { contentLanguage: "en" } });
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    include: ["httpMetadata"],
  });

  const metadatas = objects.map((o) => o.httpMetadata);
  t.deepEqual(metadatas, [
    { contentEncoding: "gzip" },
    { contentType: "dinosaur" },
    { contentLanguage: "en" },
  ]);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});

test("list: customMetadata: not included in options returns empty metadata", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1", { customMetadata: { foo: "bar" } });
  await r2.put("key2", "value2", { customMetadata: { bar: "fiz" } });
  await r2.put("key3", "value3", { customMetadata: { fiz: "bang" } });
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    include: [],
  });

  const metadatas = objects.map((o) => o.customMetadata);
  t.deepEqual(metadatas, [{}, {}, {}]);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});
test("list: customMetadata: included in options returns metadata", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1", { customMetadata: { foo: "bar" } });
  await r2.put("key2", "value2", { customMetadata: { bar: "fiz" } });
  await r2.put("key3", "value3", { customMetadata: { fiz: "bang" } });
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    include: ["customMetadata"],
  });

  const metadatas = objects.map((o) => o.customMetadata);
  t.deepEqual(metadatas, [{ foo: "bar" }, { bar: "fiz" }, { fiz: "bang" }]);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});

test("list: customMetadata & httpMetadata: included in options returns both metadatas", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1", {
    customMetadata: { foo: "bar" },
    httpMetadata: { contentEncoding: "gzip" },
  });
  await r2.put("key2", "value2", {
    customMetadata: { bar: "fiz" },
    httpMetadata: { contentType: "dinosaur" },
  });
  await r2.put("key3", "value3", {
    customMetadata: { fiz: "bang" },
    httpMetadata: { contentLanguage: "en" },
  });
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    include: ["customMetadata", "httpMetadata"],
  });

  const cMetadatas = objects.map((o) => o.customMetadata);
  t.deepEqual(cMetadatas, [{ foo: "bar" }, { bar: "fiz" }, { fiz: "bang" }]);
  const hMetadatas = objects.map((o) => o.httpMetadata);
  t.deepEqual(hMetadatas, [
    { contentEncoding: "gzip" },
    { contentType: "dinosaur" },
    { contentLanguage: "en" },
  ]);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});

test("list: include: input not customMetadata or httpMetadata fails", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ include: ["foo"] as any }), {
    instanceOf: Error,
    message:
      "R2 LIST failed: (400) include values must be httpMetadata and/or customMetadata strings.",
  });
});
test("list: include: not an array fails", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ include: "fail" as any }), {
    instanceOf: Error,
    message: "R2 LIST failed: (400) include must be an array or undefined.",
  });
});

test("list: prefix: must be a string", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ prefix: 0 as any }), {
    instanceOf: Error,
    message: "R2 LIST failed: (400) prefix must be a string or undefined.",
  });
});
test("list: cursor: must be a string", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ cursor: 0 as any }), {
    instanceOf: Error,
    message: "R2 LIST failed: (400) cursor must be a string or undefined.",
  });
});
test("list: delimiter: must be a string", async (t) => {
  const { r2 } = t.context;
  await t.throwsAsync(r2.list({ delimiter: 0 as any }), {
    instanceOf: Error,
    message: "R2 LIST failed: (400) delimiter must be a string or undefined.",
  });
});

test("list: delimiter: no delimiter returns an empty array", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1");
  await r2.put("key2", "value2");
  await r2.put("key3", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list();
  t.deepEqual(
    objects.map((o) => o.key),
    ["key1", "key2", "key3"]
  );
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, []);
});
test("list: delimiter: delimiter as empty string returns the commonality.", async (t) => {
  const { r2 } = t.context;
  await r2.put("key1", "value1");
  await r2.put("key2", "value2");
  await r2.put("key3", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    delimiter: "",
  });
  t.deepEqual(objects, []);
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, ["k"]);
});
test("list: delimiter: delimiter only pulls match", async (t) => {
  const { r2 } = t.context;
  await r2.put("a", "value1");
  await r2.put("b", "value2");
  await r2.put("c", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    delimiter: "b",
  });
  t.deepEqual(
    objects.map((o) => o.key),
    ["a", "c"]
  );
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, ["b"]);
});
test("list: delimiter: delimiter with prefix", async (t) => {
  const { r2 } = t.context;
  await r2.put("test/a", "value1");
  await r2.put("test/b", "value2");
  await r2.put("test/c", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    delimiter: "b",
    prefix: "test/",
  });
  t.deepEqual(
    objects.map((o) => o.key),
    ["test/a", "test/c"]
  );
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, ["test/b"]);
});
test("list: delimiter: just backslash returns the keys prior to the first /", async (t) => {
  const { r2 } = t.context;
  await r2.put("foo/bar/baz", "value1");
  await r2.put("a/b/c", "value2");
  await r2.put("x/y/z", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    delimiter: "/",
  });
  t.deepEqual(
    objects.map((o) => o.key),
    []
  );
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, ["a/", "foo/", "x/"]);
});
test("list: delimiter: just backslash with foo/ as prefix, foo/bar is returned", async (t) => {
  const { r2 } = t.context;
  await r2.put("foo/bar/baz", "value1");
  await r2.put("a/b/c", "value2");
  await r2.put("x/y/z", "value3");
  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list({
    prefix: "foo/",
    delimiter: "/",
  });
  t.deepEqual(
    objects.map((o) => o.key),
    []
  );
  t.false(truncated);
  t.is(cursor, undefined);
  t.deepEqual(delimitedPrefixes, ["foo/bar/"]);
});

test("hides implementation details", (t) => {
  const { r2 } = t.context;
  t.deepEqual(getObjectProperties(r2), [
    "delete",
    "get",
    "head",
    "list",
    "put",
  ]);
});
test("operations throw outside request handler", async (t) => {
  const storage = await storageFactory.factory(t, {});
  const r2 = new R2Bucket(storage, { blockGlobalAsyncIO: true });
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };
  await t.throwsAsync(r2.get("key"), expectations);
  await t.throwsAsync(r2.head("key"), expectations);
  await t.throwsAsync(r2.put("key", "value"), expectations);
  await t.throwsAsync(r2.delete("key"), expectations);
  await t.throwsAsync(r2.list(), expectations);

  await ctx.runWith(() => r2.get("key"));
  await ctx.runWith(() => r2.head("key"));
  await ctx.runWith(() => r2.put("key", "value"));
  await ctx.runWith(() => r2.delete("key"));
  await ctx.runWith(() => r2.list());
});
test("operations advance current time", async (t) => {
  const { r2 } = t.context;
  await advancesTime(t, () => r2.get("key"));
  await advancesTime(t, () => r2.head("key"));
  await advancesTime(t, () => r2.put("key", "value"));
  await advancesTime(t, () => r2.delete("key"));
  await advancesTime(t, () => r2.list());
});
