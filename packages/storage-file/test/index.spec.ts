import { promises as fs } from "fs";
import path from "path";
import { Storage, StorageOperator, StoredValueMeta } from "@miniflare/shared";
import { FileStorage, FileStorageError } from "@miniflare/storage-file";
import test, { ExecutionContext } from "ava";
import { useTmp, utf8Decode, utf8Encode } from "test:@miniflare/shared";
import {
  TestStorageFactory,
  operatorMacros,
  testClock,
  txnMacros,
} from "test:@miniflare/storage-memory";

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
      if (expiration || metadata) {
        await fs.writeFile(
          path.join(tmp, key + ".meta.json"),
          JSON.stringify({ expiration, metadata }),
          "utf8"
        );
      }
    }
    return new FileStorage(tmp, true, testClock);
  }
}

const storageFactory = new FileStorageFactory();
const transactionOperatorFactory = storageFactory.transactionOperatorFactory();

for (const macro of operatorMacros) {
  test(macro, storageFactory);
  test(macro, transactionOperatorFactory);
}
for (const macro of txnMacros) {
  test(macro, storageFactory);
}

test("FileStorage: list: returns original keys if sanitised", async (t) => {
  const storage = await storageFactory.operatorFactory(t, {});
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

async function unsanitisedOperatorFactory(
  t: ExecutionContext
): Promise<StorageOperator> {
  const tmp = await useTmp(t);
  await fs.writeFile(path.join(tmp, "secrets.txt"), "strong password", "utf8");
  const rootPath = path.join(tmp, "root");
  await fs.mkdir(rootPath);
  await fs.writeFile(path.join(rootPath, "key"), "value", "utf8");
  return new FileStorage(rootPath, false, testClock);
}
test("FileStorage: has: ignores files outside root", async (t) => {
  const storage = await unsanitisedOperatorFactory(t);
  t.true(await storage.has("dir/../key"));
  t.false(await storage.has("../secrets.txt"));
});
test("FileStorage: get: ignores files outside root", async (t) => {
  const storage = await unsanitisedOperatorFactory(t);
  t.is(utf8Decode((await storage.get("dir/../key"))?.value), "value");
  t.is(await storage.get("../secrets.txt"), undefined);
});
test("FileStorage: put: throws on files outside root", async (t) => {
  const storage = await unsanitisedOperatorFactory(t);
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
  const storage = await unsanitisedOperatorFactory(t);
  t.true(await storage.delete("dir/../key"));
  t.false(await storage.delete("../secrets.txt"));
});
