import { existsSync, promises as fs } from "fs";
import path from "path";
import test from "ava";
import { KVStorageNamespace, NoOpLog } from "../../src";
import { KVModule } from "../../src/modules/kv";
import { runInWorker, useTmp } from "../helpers";

test("getNamespace: creates persistent namespace at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);
  const ns = module.getNamespace("TEST_NAMESPACE", true);
  await ns.put("key", "value");
  t.is(
    await fs.readFile(path.join(tmp, "TEST_NAMESPACE", "key"), "utf8"),
    "value"
  );
});
test("getNamespace: creates persistent namespace at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmpDefault);
  const ns = module.getNamespace("TEST_NAMESPACE", tmpCustom);
  await ns.put("key", "value");
  t.false(existsSync(path.join(tmpDefault, "TEST_NAMESPACE", "key")));
  t.is(
    await fs.readFile(path.join(tmpCustom, "TEST_NAMESPACE", "key"), "utf8"),
    "value"
  );
});
test("getNamespace: creates in-memory namespace", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);
  const ns = module.getNamespace("TEST_NAMESPACE");
  await ns.put("key", "value");
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE", "key")));
  t.is(await ns.get("key"), "value");
});
test("getNamespace: reuses existing storage for in-memory namespace", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);
  const ns1 = module.getNamespace("TEST_NAMESPACE", false);
  await ns1.put("key1", "value1");
  const ns2 = module.getNamespace("TEST_NAMESPACE", false);
  await ns2.put("key2", "value2");
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE", "key1")));
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE", "key2")));
  t.is(await ns1.get("key1"), "value1");
  t.is(await ns1.get("key2"), "value2");
  t.is(await ns2.get("key1"), "value1");
  t.is(await ns2.get("key2"), "value2");
});

test("buildEnvironment: creates persistent namespaces at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);
  const environment = module.buildEnvironment({
    kvNamespaces: ["TEST_NAMESPACE_1", "TEST_NAMESPACE_2"],
    kvPersist: true,
  });
  t.true("TEST_NAMESPACE_1" in environment);
  t.true("TEST_NAMESPACE_2" in environment);
  await environment.TEST_NAMESPACE_1.put("key", "value1");
  await environment.TEST_NAMESPACE_2.put("key", "value2");
  t.is(
    await fs.readFile(path.join(tmp, "TEST_NAMESPACE_1", "key"), "utf8"),
    "value1"
  );
  t.is(
    await fs.readFile(path.join(tmp, "TEST_NAMESPACE_2", "key"), "utf8"),
    "value2"
  );
});
test("buildEnvironment: creates persistent namespaces at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmpDefault);
  const environment = module.buildEnvironment({
    kvNamespaces: ["TEST_NAMESPACE_1", "TEST_NAMESPACE_2"],
    kvPersist: tmpCustom,
  });
  t.true("TEST_NAMESPACE_1" in environment);
  t.true("TEST_NAMESPACE_2" in environment);
  await environment.TEST_NAMESPACE_1.put("key", "value1");
  await environment.TEST_NAMESPACE_2.put("key", "value2");
  t.false(existsSync(path.join(tmpDefault, "TEST_NAMESPACE_1", "key")));
  t.false(existsSync(path.join(tmpDefault, "TEST_NAMESPACE_2", "key")));
  t.is(
    await fs.readFile(path.join(tmpCustom, "TEST_NAMESPACE_1", "key"), "utf8"),
    "value1"
  );
  t.is(
    await fs.readFile(path.join(tmpCustom, "TEST_NAMESPACE_2", "key"), "utf8"),
    "value2"
  );
});
test("buildEnvironment: creates in-memory namespaces", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);
  const environment = module.buildEnvironment({
    kvNamespaces: ["TEST_NAMESPACE_1", "TEST_NAMESPACE_2"],
    kvPersist: false,
  });
  t.true("TEST_NAMESPACE_1" in environment);
  t.true("TEST_NAMESPACE_2" in environment);
  await environment.TEST_NAMESPACE_1.put("key", "value1");
  await environment.TEST_NAMESPACE_2.put("key", "value2");
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_1", "key")));
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_2", "key")));
  t.is(await environment.TEST_NAMESPACE_1.get("key"), "value1");
  t.is(await environment.TEST_NAMESPACE_2.get("key"), "value2");
});
test("buildEnvironment: reuses existing storage for in-memory namespaces", async (t) => {
  const tmp = await useTmp(t);
  const module = new KVModule(new NoOpLog(), tmp);

  const environment1 = module.buildEnvironment({
    kvNamespaces: ["TEST_NAMESPACE_1", "TEST_NAMESPACE_2"],
  });
  t.true("TEST_NAMESPACE_1" in environment1);
  t.true("TEST_NAMESPACE_2" in environment1);
  await environment1.TEST_NAMESPACE_1.put("key1", "value11");
  await environment1.TEST_NAMESPACE_2.put("key1", "value12");

  const environment2 = module.buildEnvironment({
    kvNamespaces: ["TEST_NAMESPACE_1", "TEST_NAMESPACE_2"],
  });
  t.true("TEST_NAMESPACE_1" in environment2);
  t.true("TEST_NAMESPACE_2" in environment2);
  await environment2.TEST_NAMESPACE_1.put("key2", "value21");
  await environment2.TEST_NAMESPACE_2.put("key2", "value22");

  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_1", "key1")));
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_2", "key1")));
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_1", "key2")));
  t.false(existsSync(path.join(tmp, "TEST_NAMESPACE_2", "key2")));

  t.is(await environment1.TEST_NAMESPACE_1.get("key1"), "value11");
  t.is(await environment1.TEST_NAMESPACE_1.get("key2"), "value21");
  t.is(await environment1.TEST_NAMESPACE_2.get("key1"), "value12");
  t.is(await environment1.TEST_NAMESPACE_2.get("key2"), "value22");
  t.is(await environment2.TEST_NAMESPACE_1.get("key1"), "value11");
  t.is(await environment2.TEST_NAMESPACE_1.get("key2"), "value21");
  t.is(await environment2.TEST_NAMESPACE_2.get("key1"), "value12");
  t.is(await environment2.TEST_NAMESPACE_2.get("key2"), "value22");
});

test("buildEnvironment: can get from namespace", async (t) => {
  const tmp = await useTmp(t);
  await fs.mkdir(path.join(tmp, "TEST_NAMESPACE"));
  await fs.writeFile(path.join(tmp, "TEST_NAMESPACE", "key"), "value", "utf8");
  const res = await runInWorker(
    { kvNamespaces: ["TEST_NAMESPACE"], kvPersist: tmp },
    () => {
      const ns = (self as any).TEST_NAMESPACE as KVStorageNamespace;
      return ns.get("key");
    }
  );
  t.is(res, "value");
});
test("buildEnvironment: can getWithMetadata from namespace", async (t) => {
  const tmp = await useTmp(t);
  await fs.mkdir(path.join(tmp, "TEST_NAMESPACE"));
  await fs.writeFile(path.join(tmp, "TEST_NAMESPACE", "key"), "value", "utf8");
  await fs.writeFile(
    path.join(tmp, "TEST_NAMESPACE", "key.meta.json"),
    JSON.stringify({ metadata: { testing: true } }),
    "utf8"
  );
  const res = await runInWorker(
    { kvNamespaces: ["TEST_NAMESPACE"], kvPersist: tmp },
    () => {
      const ns = (self as any).TEST_NAMESPACE as KVStorageNamespace;
      return ns.getWithMetadata("key");
    }
  );
  t.deepEqual(res, { value: "value", metadata: { testing: true } });
});
test("buildEnvironment: can put into namespace", async (t) => {
  const tmp = await useTmp(t);
  await runInWorker(
    { kvNamespaces: ["TEST_NAMESPACE"], kvPersist: tmp },
    () => {
      const ns = (self as any).TEST_NAMESPACE as KVStorageNamespace;
      return ns.put("key", "value", { metadata: { testing: true } });
    }
  );
  t.is(
    await fs.readFile(path.join(tmp, "TEST_NAMESPACE", "key"), "utf8"),
    "value"
  );
  t.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(tmp, "TEST_NAMESPACE", "key.meta.json"),
        "utf8"
      )
    ),
    { metadata: { testing: true } }
  );
});
test("buildEnvironment: can delete from namespace", async (t) => {
  const tmp = await useTmp(t);
  await fs.mkdir(path.join(tmp, "TEST_NAMESPACE"));
  const keyPath = path.join(tmp, "TEST_NAMESPACE", "key");
  await fs.writeFile(keyPath, "value", "utf8");
  t.true(existsSync(keyPath));
  await runInWorker(
    { kvNamespaces: ["TEST_NAMESPACE"], kvPersist: tmp },
    () => {
      const ns = (self as any).TEST_NAMESPACE as KVStorageNamespace;
      return ns.delete("key");
    }
  );
  t.false(existsSync(keyPath));
});
test("buildEnvironment: can list namespace", async (t) => {
  const tmp = await useTmp(t);
  await fs.mkdir(path.join(tmp, "TEST_NAMESPACE"));
  await fs.writeFile(path.join(tmp, "TEST_NAMESPACE", "key1"), "value", "utf8");
  await fs.writeFile(path.join(tmp, "TEST_NAMESPACE", "key2"), "value", "utf8");
  const res = await runInWorker(
    { kvNamespaces: ["TEST_NAMESPACE"], kvPersist: tmp },
    () => {
      const ns = (self as any).TEST_NAMESPACE as KVStorageNamespace;
      return ns.list();
    }
  );
  t.deepEqual(res, {
    keys: [{ name: "key1" }, { name: "key2" }],
    list_complete: true,
    cursor: "",
  });
});
