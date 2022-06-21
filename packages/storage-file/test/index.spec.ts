import fs from "fs/promises";
import path from "path";
import { Storage, StoredValueMeta, sanitisePath } from "@miniflare/shared";
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

  const getFront = await storage.getRangeMaybeExpired?.("key", 0, 3);
  t.is(utf8Decode(getFront?.value), "123");
  const getBack = await storage.getRangeMaybeExpired?.("key", 6, 3);
  t.is(utf8Decode(getBack?.value), "789");
  const getMiddle = await storage.getRangeMaybeExpired?.("key", 3, 3);
  t.is(utf8Decode(getMiddle?.value), "456");

  // below 0 start defaults to 0
  const outside = await storage.getRangeMaybeExpired?.("key", -2, 3);
  t.is(utf8Decode(outside?.value), "123");
  // past end adds 0 for each missing byte
  const outside2 = await storage.getRangeMaybeExpired?.("key", 12, 7);
  t.is(
    utf8Decode(outside2?.value),
    utf8Decode(new Uint8Array([0, 0, 0, 0, 0, 0, 0]))
  );
  // length past end just pads with 0s for each missing byte
  const outside3 = await storage.getRangeMaybeExpired?.("key", 6, 6);
  t.is(
    utf8Decode(outside3?.value),
    "789" + utf8Decode(new Uint8Array([0, 0, 0]))
  );
});

async function unsanitisedStorageFactory(
  t: ExecutionContext
): Promise<Storage> {
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
      (await storage.getRangeMaybeExpired?.("dir/../key", 0, 5))?.value
    ),
    "value"
  );
  t.is(await storage.getRangeMaybeExpired?.("../secrets.txt", 0, 6), undefined);
});
test("FileStorage: getRangeMaybeExpired: non-existant file returns undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  t.is(await storage.getRangeMaybeExpired?.("doesntexist", 0, 6), undefined);
});
test("FileStorage: getRangeMaybeExpired: dir that does not exist will return undefined", async (t) => {
  const storage = await unsanitisedStorageFactory(t);
  const empty = await storage.getRangeMaybeExpired?.("key/sub-key", 0, 6);
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
