import fs from "fs/promises";
import path from "path";
import { StoredValueMeta, sanitisePath } from "@miniflare/shared";
import {
  TestStorageFactory,
  storageMacros,
  testClock,
  useTmp,
  utf8Decode,
  utf8Encode,
} from "@miniflare/shared-test";
import { FileStorage, FileStorageError } from "@miniflare/storage-file";
import test, { ExecutionContext } from "ava";

class FileStorageFactory extends TestStorageFactory {
  name = "FileStorage";

  async factory(
    t: ExecutionContext,
    seed: Record<string, StoredValueMeta>
  ): Promise<FileStorage> {
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
  test(macro, storageFactory);
}

test("FileStorage: put: recognises limitation when putting into namespace that is also a key", async (t) => {
  const storage = await storageFactory.factory(t, {});
  await storage.put("key", { value: utf8Encode("value") });
  await t.throwsAsync(
    async () => storage.put("key/thing", { value: utf8Encode("value") }),
    {
      instanceOf: FileStorageError,
      code: "ERR_NAMESPACE_KEY_CHILD",
      message:
        /^Cannot put key "key\/thing" as a parent namespace is also a key/,
    }
  );
});
test("FileStorage: list: returns original keys if sanitised", async (t) => {
  const storage = await storageFactory.factory(t, {});
  const unsafeKey = "namespace:<a>/../c?   ";
  await storage.put(unsafeKey, { value: utf8Encode("value") });

  const getResult = await storage.get(unsafeKey);
  t.is(utf8Decode(getResult?.value), "value");

  const listResult = await storage.list();
  t.deepEqual(listResult, {
    keys: [{ name: unsafeKey, expiration: undefined, metadata: undefined }],
    cursor: "",
  });
});
test("FileStorage: getRangeMaybeExpired: returns partial values", async (t) => {
  const storage = await storageFactory.factory(t, {});
  await storage.put("key", { value: utf8Encode("123456789") });

  const getFront = await storage.getRangeMaybeExpired("key", {
    offset: 0,
    length: 3,
  });
  t.is(utf8Decode(getFront?.value), "123");
  t.deepEqual(getFront?.range, { offset: 0, length: 3 });
  const getBack = await storage.getRangeMaybeExpired("key", {
    offset: 6,
    length: 3,
  });
  t.is(utf8Decode(getBack?.value), "789");
  t.deepEqual(getBack?.range, { offset: 6, length: 3 });
  const getMiddle = await storage.getRangeMaybeExpired("key", {
    offset: 3,
    length: 3,
  });
  t.is(utf8Decode(getMiddle?.value), "456");
  t.deepEqual(getMiddle?.range, { offset: 3, length: 3 });

  // length past end just reduces length
  const outside3 = await storage.getRangeMaybeExpired("key", {
    offset: 6,
    length: 6,
  });
  t.is(utf8Decode(outside3?.value), "789");
  t.deepEqual(outside3?.range, { offset: 6, length: 3 });
  // no length provided, returns entire value from start
  const outside4 = await storage.getRangeMaybeExpired("key", { offset: 3 });
  t.is(utf8Decode(outside4?.value), "456789");
  t.deepEqual(outside4?.range, { offset: 3, length: 6 });
});
test("FileStorage: getRangeMaybeExpired: throw cases", async (t) => {
  t.plan(6);
  const storage = await storageFactory.factory(t, {});
  await storage.put("key", { value: utf8Encode("123456789") });

  // length 0
  await t.throwsAsync(
    async () =>
      await storage.getRangeMaybeExpired("key", { offset: 0, length: 0 }),
    {
      message: "Length must be > 0",
    }
  );
  // length less than 0
  await t.throwsAsync(
    async () =>
      await storage.getRangeMaybeExpired("key", { offset: 0, length: -2 }),
    {
      message: "Length must be > 0",
    }
  );
  // offset less than 0
  await t.throwsAsync(
    async () => await storage.getRangeMaybeExpired("key", { offset: -2 }),
    {
      message: "Offset must be >= 0",
    }
  );
  // offset greather than size
  await t.throwsAsync(
    async () => await storage.getRangeMaybeExpired("key", { offset: 50 }),
    {
      message: "Offset must be < size",
    }
  );
  // suffix 0
  await t.throwsAsync(
    async () => await storage.getRangeMaybeExpired("key", { suffix: 0 }),
    {
      message: "Suffix must be > 0",
    }
  );
  // suffix less than 0
  await t.throwsAsync(
    async () => await storage.getRangeMaybeExpired("key", { suffix: -2 }),
    {
      message: "Suffix must be > 0",
    }
  );
});
test("FileStorage: getRangeMaybeExpired: suffix: returns partial values", async (t) => {
  const storage = await storageFactory.factory(t, {});
  await storage.put("key", { value: utf8Encode("123456789") });

  const getThree = await storage.getRangeMaybeExpired("key", { suffix: 3 });
  t.is(utf8Decode(getThree?.value), "789");
  t.deepEqual(getThree?.range, { offset: 6, length: 3 });
  const getAll = await storage.getRangeMaybeExpired("key", { suffix: 9 });
  t.is(utf8Decode(getAll?.value), "123456789");
  t.deepEqual(getAll?.range, { offset: 0, length: 9 });
});
test("FileStorage: getRangeMaybeExpired: check that symbolic links are resolved appropriately", async (t) => {
  const storage = await storageFactory.factory(t, {});
  await storage.put("inner/key", { value: utf8Encode("value") });
  // create the symbolic link
  await fs.symlink(
    // @ts-ignore
    path.join(storage.root, "inner/key"),
    // @ts-ignore
    path.join(storage.root, "key")
  );
  const getResult = await storage.getRangeMaybeExpired("key", { offset: 0 });
  t.is(utf8Decode(getResult?.value), "value");
  t.deepEqual(getResult?.range, { offset: 0, length: 5 });
});

async function unsanitisedStorageFactory(
  t: ExecutionContext
): Promise<FileStorage> {
  const tmp = await useTmp(t);
  await fs.writeFile(path.join(tmp, "secrets.txt"), "strong password", "utf8");
  const rootPath = path.join(tmp, "root");
  await fs.mkdir(rootPath);
  await fs.writeFile(path.join(rootPath, "key"), "value", "utf8");
  return new FileStorage(rootPath, false, testClock);
}
test("FileStorage: has: ignores files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.true(await storage.has("dir/../key"));
  t.false(await storage.has("../secrets.txt"));
});
test("FileStorage: get: ignores files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(utf8Decode((await storage.get("dir/../key"))?.value), "value");
  t.is(await storage.get("../secrets.txt"), undefined);
});
test("FileStorage: getRangeMaybeExpired: ignores files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(
    utf8Decode(
      (
        await storage.getRangeMaybeExpired("dir/../key", {
          offset: 0,
          length: 5,
        })
      )?.value
    ),
    "value"
  );
  t.is(
    await storage.getRangeMaybeExpired("../secrets.txt", {
      offset: 0,
      length: 6,
    }),
    undefined
  );
});
test("FileStorage: getRangeMaybeExpired: suffix: ignores files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(
    utf8Decode(
      (await storage.getRangeMaybeExpired("dir/../key", { suffix: 5 }))?.value
    ),
    "value"
  );
  t.is(
    await storage.getRangeMaybeExpired("../secrets.txt", { offset: 0 }),
    undefined
  );
});
test("FileStorage: getRangeMaybeExpired: non-existant file returns undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(
    await storage.getRangeMaybeExpired("doesntexist", { offset: 0, length: 6 }),
    undefined
  );
});
test("FileStorage: getRangeMaybeExpired: suffix: non-existant file returns undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(
    await storage.getRangeMaybeExpired("doesntexist", { suffix: 6 }),
    undefined
  );
});
test("FileStorage: getRangeMaybeExpired: dir that does not exist will return undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  const empty = await storage.getRangeMaybeExpired("key/sub-key", {
    offset: 0,
    length: 6,
  });
  t.is(empty, undefined);
});
test("FileStorage: getRangeMaybeExpired: suffix: dir that does not exist will return undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  const empty = await storage.getRangeMaybeExpired("key/sub-key", {
    suffix: 1,
  });
  t.is(empty, undefined);
});
test("FileStorage: put: throws on files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  await t.throwsAsync(
    async () =>
      storage.put("../secrets.txt", { value: utf8Encode("weak password") }),
    {
      instanceOf: FileStorageError,
      code: "ERR_TRAVERSAL",
    }
  );
});
test("FileStorage: delete: ignores files outside root", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.true(await storage.delete("dir/../key"));
  t.false(await storage.delete("../secrets.txt"));
});
