import { existsSync, promises as fs } from "fs";
import path from "path";
import test from "ava";
import { MemoryKVStorage } from "../../src";
import {
  KVStorageFactory,
  Mutex,
  intersects,
  sanitise,
} from "../../src/kv/helpers";
import { useTmp } from "../helpers";

test("sanitise: sanitises file name", (t) => {
  t.is(sanitise("one:two/three"), "one_two_three");
});

test("intersects: returns true if sets intersect", (t) => {
  t.true(intersects(new Set(["a", "b", "c"]), new Set(["c", "d", "e"])));
});

test("intersects: returns false is sets disjoint", (t) => {
  t.false(intersects(new Set(["a", "b", "c"]), new Set(["d", "e"])));
});

test("intersects: returns false is either set empty", (t) => {
  t.false(intersects(new Set(), new Set(["a"])));
  t.false(intersects(new Set(["a"]), new Set()));
});

test("getStorage: creates persistent storage at default location", async (t) => {
  const tmp = await useTmp(t);
  const factory = new KVStorageFactory(tmp);
  const storage = factory.getStorage("ns", true);
  await storage.put("key", { value: Buffer.from("value", "utf8") });
  t.is(await fs.readFile(path.join(tmp, "ns", "key"), "utf8"), "value");
});

test("getStorage: creates persistent storage at custom location", async (t) => {
  const tmp = await useTmp(t);
  const factory = new KVStorageFactory(path.join(tmp, "default"));
  const storage = factory.getStorage("ns", path.join(tmp, "custom"));
  await storage.put("key", { value: Buffer.from("value", "utf8") });
  t.false(existsSync(path.join(tmp, "default", "ns", "key")));
  t.is(
    await fs.readFile(path.join(tmp, "custom", "ns", "key"), "utf8"),
    "value"
  );
});

test("getStorage: sanitises namespace when creating persistent storage", async (t) => {
  const tmp = await useTmp(t);
  const factory = new KVStorageFactory(tmp);
  const storage = factory.getStorage("a:b/c\\d", true);
  await storage.put("key", { value: Buffer.from("value", "utf8") });
  t.is(await fs.readFile(path.join(tmp, "a_b_c_d", "key"), "utf8"), "value");
});

test("getStorage: creates in-memory storage", async (t) => {
  const tmp = await useTmp(t);
  const memoryStorages = new Map<string, MemoryKVStorage>();
  const factory = new KVStorageFactory(tmp, memoryStorages);
  const storage = factory.getStorage("ns");
  await storage.put("key", { value: Buffer.from("value", "utf8") });
  t.is(
    (await memoryStorages.get("ns")?.get("key"))?.value.toString("utf8"),
    "value"
  );
});

test("getStorage: reuses existing in-memory storages", async (t) => {
  const tmp = await useTmp(t);
  const factory = new KVStorageFactory(tmp);
  const storage1 = factory.getStorage("ns");
  await storage1.put("key", { value: Buffer.from("value", "utf8") });
  const storage2 = factory.getStorage("ns");
  t.is((await storage2.get("key"))?.value.toString("utf8"), "value");
});

test("Mutex: runs closures exclusively", async (t) => {
  const mutex = new Mutex();
  const results: number[] = [];
  await Promise.all([
    mutex.run(async () => {
      results.push(1);
      await new Promise((resolve) => setTimeout(resolve, 500));
      results.push(2);
    }),
    mutex.run(async () => {
      results.push(3);
    }),
  ]);
  t.deepEqual(results, [1, 2, 3]);
});
