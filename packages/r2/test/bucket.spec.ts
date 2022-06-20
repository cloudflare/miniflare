import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { ReadableStream } from "stream/web";
import {
  R2Bucket,
  R2HTTPMetadata,
  R2ListOptions,
  R2ObjectMetadata,
  R2Objects,
  R2PutOptions,
  R2PutValueType,
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
// test("list: paginates with variable limit", async (t) => {
//   const { r2 } = t.context;
//   await r2.put("key1", "value1");
//   await r2.put("key2", "value2");
//   await r2.put("key3", "value3");

//   // Get first page
//   let page = await r2.list({ limit: 1 });
//   t.deepEqual(page.objects, [
//     { key: "key1" },
//   ]);
//   t.false(page.truncated);
//   t.not(page.cursor, "");

//   // Get second page with different limit
//   page = await r2.list({ limit: 2, cursor: page.cursor });
//   t.deepEqual(page.objects, [
//     { key: "key2" },
//     { key: "key3" },
//   ]);
//   t.true(page.truncated);
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
test("list: sorts lexicographically", async (t) => {
  const { r2 } = t.context;
  await r2.put(", ", "value");
  await r2.put("!", "value");

  const { objects, truncated, cursor, delimitedPrefixes } = await r2.list();
  t.is(objects[0].key, "!");
  t.is(objects[1].key, ", ");
  t.false(truncated);
  t.is(cursor, "");
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
    message:
      "R2 LIST failed: 400 MaxKeys params must be positive integer <= 1000.",
  });
  await t.throwsAsync(r2.list({ limit: 0 }), {
    instanceOf: Error,
    message:
      "R2 LIST failed: 400 MaxKeys params must be positive integer <= 1000.",
  });
  await t.throwsAsync(r2.list({ limit: 1001 }), {
    instanceOf: Error,
    message:
      "R2 LIST failed: 400 MaxKeys params must be positive integer <= 1000.",
  });
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
