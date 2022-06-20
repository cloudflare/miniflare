import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { ReadableStream } from "stream/web";
import {
  R2ListOptions,
  R2Bucket,
  R2PutOptions,
  R2PutValueType,
  R2ObjectMetadata,
  R2Object,
  R2HTTPMetadata,
  R2Objects,
} from "@miniflare/r2";
import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  RequestContextOptions,
  Storage,
  StoredKeyMeta,
  StoredValueMeta,
  base64Encode,
  sanitisePath,
} from "@miniflare/shared";
import {
  advancesTime,
  getObjectProperties,
  testClock,
  utf8Decode,
  utf8Encode,
  waitsForInputGate,
  waitsForOutputGate,
  TestStorageFactory,
  useTmp,
  storageMacros,
} from "@miniflare/shared-test";
import { FileStorage } from "@miniflare/storage-file";
import anyTest, {
  ExecutionContext,
  Macro,
  TestInterface,
  ThrowsExpectation,
} from "ava";

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
  uploaded?: Date;
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

const storageFactory = new FileStorageFactory();
for (const macro of storageMacros) {
  anyTest(macro, storageFactory);
}

const test = anyTest as TestInterface<Context>;

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
  await t.throwsAsync(func(r2, ""), {
    instanceOf: TypeError,
    message: "Key name cannot be empty.",
  });
  await t.throwsAsync(func(r2, "."), {
    instanceOf: TypeError,
    message: '"." is not allowed as a key name.',
  });
  await t.throwsAsync(func(r2, ".."), {
    instanceOf: TypeError,
    message: '".." is not allowed as a key name.',
  });
  await t.throwsAsync(func(r2, "".padStart(513, "x")), {
    instanceOf: Error,
    message: `R2 ${httpMethod} failed: 414 UTF-8 encoded length of 513 exceeds key length limit of 512.`,
  });
};
validatesKeyMacro.title = (providedTitle, method) => `${method}: validates key`;

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

const putMacro: Macro<
  [
    {
      key: string;
      value: R2PutValueType;
      options?: R2PutOptions;
      expected: StoredValueMeta;
    }
  ],
  Context
> = async (t, { key, value, options, expected }) => {
  const { storage, r2 } = t.context;
  await r2.put(key, value, options);

  const get = await storage.get<R2ObjectMetadata>(key);
  const metadata = get?.metadata;

  t.is(key, metadata?.key);
  // t.is(get?.value.byteLength, expected.size);
  t.deepEqual(get?.value, expected.value);
  t.is(get?.expiration, undefined);
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

test("delete: deletes existing keys", async (t) => {
  const { storage, r2 } = t.context;
  await storage.put("key", { value: utf8Encode("value") });
  t.not(await storage.get("key"), undefined);
  await r2.delete("key");
  t.is(await storage.get("key"), undefined);
});
test("delete: does nothing for non-existent keys", async (t) => {
  const { r2 } = t.context;
  await r2.delete("key");
  await t.pass();
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
      values: Record<string, StoredValueMeta>;
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
    objects: expectedObject,
    delimitedPrefixes: expectedDP,
  }
) => {
  const { storage, r2 } = t.context;
  for (const [key, value] of Object.entries(values)) {
    await storage.put(key, value);
  }

  let lastCursor: string | undefined;
  for (let i = 0; i < expectedObject.length; i++) {
    const listRes: R2Objects = await r2.list({
      prefix: options.prefix,
      limit: options.limit,
      cursor: options.cursor ?? lastCursor,
    });
    const { cursor, objects, truncated, delimitedPrefixes } = listRes;
    t.deepEqual(
      objects.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        uploaded: o.uploaded,
        httpMetadata: o.httpMetadata,
        customMetadata: o.customMetadata,
      })) as TestR2ObjectMetadata[],
      expectedObject[i]
    );
    if (i === objects.length - 1) {
      // Last Page
      t.true(truncated);
      t.is(cursor, "");
    } else {
      t.false(truncated);
      t.not(cursor, "");
    }
    t.is(delimitedPrefixes, expectedDP);
    lastCursor = cursor;
  }
};
listMacro.title = (providedTitle) => `list: ${providedTitle}`;
test("lists keys in sorted order", listMacro, {
  values: {
    key3: { value: utf8Encode("value3") },
    key1: { value: utf8Encode("value1") },
    key2: { value: utf8Encode("value2") },
  },
  objects: [[{ key: "key1" }, { key: "key2" }, { key: "key3" }]],
});
// test("lists keys matching prefix", listMacro, {
//   values: {
//     section1key1: { value: utf8Encode("value11") },
//     section1key2: { value: utf8Encode("value12") },
//     section2key1: { value: utf8Encode("value21") },
//   },
//   options: { prefix: "section1" },
//   pages: [[{ name: "section1key1" }, { name: "section1key2" }]],
// });
// test("lists keys with expiration", listMacro, {
//   values: {
//     key1: { value: utf8Encode("value1"), expiration: TIME_EXPIRING },
//     key2: { value: utf8Encode("value2"), expiration: TIME_EXPIRING + 100 },
//     key3: { value: utf8Encode("value3"), expiration: TIME_EXPIRING + 200 },
//   },
//   pages: [
//     [
//       { name: "key1", expiration: TIME_EXPIRING },
//       { name: "key2", expiration: TIME_EXPIRING + 100 },
//       { name: "key3", expiration: TIME_EXPIRING + 200 },
//     ],
//   ],
// });
// test("lists keys with metadata", listMacro, {
//   values: {
//     key1: { value: utf8Encode("value1"), metadata: { testing: 1 } },
//     key2: { value: utf8Encode("value2"), metadata: { testing: 2 } },
//     key3: { value: utf8Encode("value3"), metadata: { testing: 3 } },
//   },
//   pages: [
//     [
//       { name: "key1", metadata: { testing: 1 } },
//       { name: "key2", metadata: { testing: 2 } },
//       { name: "key3", metadata: { testing: 3 } },
//     ],
//   ],
// });
// test("lists keys with expiration and metadata", listMacro, {
//   values: {
//     key1: {
//       value: utf8Encode("value1"),
//       expiration: TIME_EXPIRING,
//       metadata: { testing: 1 },
//     },
//     key2: {
//       value: utf8Encode("value2"),
//       expiration: TIME_EXPIRING + 100,
//       metadata: { testing: 2 },
//     },
//     key3: {
//       value: utf8Encode("value3"),
//       expiration: TIME_EXPIRING + 200,
//       metadata: { testing: 3 },
//     },
//   },
//   pages: [
//     [
//       {
//         name: "key1",
//         expiration: TIME_EXPIRING,
//         metadata: { testing: 1 },
//       },
//       {
//         name: "key2",
//         expiration: TIME_EXPIRING + 100,
//         metadata: { testing: 2 },
//       },
//       {
//         name: "key3",
//         expiration: TIME_EXPIRING + 200,
//         metadata: { testing: 3 },
//       },
//     ],
//   ],
// });
// test("returns an empty list with no keys", listMacro, {
//   values: {},
//   pages: [[]],
// });
// test("returns an empty list with no matching keys", listMacro, {
//   values: {
//     key1: { value: utf8Encode("value1") },
//     key2: { value: utf8Encode("value2") },
//     key3: { value: utf8Encode("value3") },
//   },
//   options: { prefix: "none" },
//   pages: [[]],
// });
// test("returns an empty list with an invalid cursor", listMacro, {
//   values: {
//     key1: { value: utf8Encode("value1") },
//     key2: { value: utf8Encode("value2") },
//     key3: { value: utf8Encode("value3") },
//   },
//   options: { cursor: base64Encode("bad") },
//   pages: [[]],
// });
// test("paginates keys", listMacro, {
//   values: {
//     key1: { value: utf8Encode("value1") },
//     key2: { value: utf8Encode("value2") },
//     key3: { value: utf8Encode("value3") },
//   },
//   options: { limit: 2 },
//   pages: [[{ name: "key1" }, { name: "key2" }], [{ name: "key3" }]],
// });
// test("paginates keys matching prefix", listMacro, {
//   values: {
//     section1key1: { value: utf8Encode("value11") },
//     section1key2: { value: utf8Encode("value12") },
//     section1key3: { value: utf8Encode("value13") },
//     section2key1: { value: utf8Encode("value21") },
//   },
//   options: { prefix: "section1", limit: 2 },
//   pages: [
//     [{ name: "section1key1" }, { name: "section1key2" }],
//     [{ name: "section1key3" }],
//   ],
// });
// test("list: paginates with variable limit", async (t) => {
//   const { storage, r2 } = t.context;
//   await storage.put("key1", { value: utf8Encode("value1") });
//   await storage.put("key2", { value: utf8Encode("value2") });
//   await storage.put("key3", { value: utf8Encode("value3") });

//   // Get first page
//   let page = await r2.list({ limit: 1 });
//   t.deepEqual(page.keys, [
//     { name: "key1", expiration: undefined, metadata: undefined },
//   ]);
//   t.false(page.list_complete);
//   t.not(page.cursor, "");

//   // Get second page with different limit
//   page = await r2.list({ limit: 2, cursor: page.cursor });
//   t.deepEqual(page.keys, [
//     { name: "key2", expiration: undefined, metadata: undefined },
//     { name: "key3", expiration: undefined, metadata: undefined },
//   ]);
//   t.true(page.list_complete);
//   t.is(page.cursor, "");
// });
// test("list: returns keys inserted whilst paginating", async (t) => {
//   const { storage, ns } = t.context;
//   await storage.put("key1", { value: utf8Encode("value1") });
//   await storage.put("key3", { value: utf8Encode("value3") });
//   await storage.put("key5", { value: utf8Encode("value5") });

//   // Get first page
//   let page = await ns.list({ limit: 2 });
//   t.deepEqual(page.keys, [
//     { name: "key1", expiration: undefined, metadata: undefined },
//     { name: "key3", expiration: undefined, metadata: undefined },
//   ]);
//   t.false(page.list_complete);
//   t.not(page.cursor, "");

//   // Insert key2 and key4
//   await storage.put("key2", { value: utf8Encode("value2") });
//   await storage.put("key4", { value: utf8Encode("value4") });

//   // Get second page, expecting to see key4 but not key2
//   page = await ns.list({ limit: 2, cursor: page.cursor });
//   t.deepEqual(page.keys, [
//     { name: "key4", expiration: undefined, metadata: undefined },
//     { name: "key5", expiration: undefined, metadata: undefined },
//   ]);
//   t.true(page.list_complete);
//   t.is(page.cursor, "");
// });
// test("list: ignores expired keys", async (t) => {
//   const { storage, ns } = t.context;
//   for (let i = 1; i <= 3; i++) {
//     await storage.put(`key${i}`, {
//       value: utf8Encode(`value${i}`),
//       expiration: i * 100,
//     });
//   }
//   t.deepEqual(await ns.list(), { keys: [], list_complete: true, cursor: "" });
// });
// test("list: sorts lexicographically", async (t) => {
//   const { storage, ns } = t.context;
//   await storage.put(", ", { value: utf8Encode("value") });
//   await storage.put("!", { value: utf8Encode("value") });
//   t.deepEqual(await ns.list(), {
//     keys: [
//       { name: "!", expiration: undefined, metadata: undefined },
//       { name: ", ", expiration: undefined, metadata: undefined },
//     ],
//     list_complete: true,
//     cursor: "",
//   });
// });
// test("list: increments subrequest count", async (t) => {
//   const { ns } = t.context;
//   const ctx = new RequestContext(requestCtxOptions);
//   await ctx.runWith(() => ns.list());
//   t.is(ctx.internalSubrequests, 1);
// });
// test("list: waits for input gate to open before returning", async (t) => {
//   const { ns } = t.context;
//   await ns.put("key", "value");
//   await waitsForInputGate(t, () => ns.list());
// });
// test("list: validates limit", async (t) => {
//   const { ns } = t.context;
//   await t.throwsAsync(ns.list({ limit: "nan" as any }), {
//     instanceOf: Error,
//     message:
//       "KV GET failed: 400 Invalid key_count_limit of nan. Please specify an integer greater than 0.",
//   });
//   await t.throwsAsync(ns.list({ limit: 0 }), {
//     instanceOf: Error,
//     message:
//       "KV GET failed: 400 Invalid key_count_limit of 0. Please specify an integer greater than 0.",
//   });
//   await t.throwsAsync(ns.list({ limit: 1001 }), {
//     instanceOf: Error,
//     message:
//       "KV GET failed: 400 Invalid key_count_limit of 1001. Please specify an integer less than 1000.",
//   });
// });

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
