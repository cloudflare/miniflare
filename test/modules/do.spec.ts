import { existsSync, promises as fs } from "fs";
import path from "path";
import test from "ava";
import {
  DurableObject,
  KVStoredValue,
  Miniflare,
  MiniflareError,
  NoOpLog,
  Request,
  Response,
} from "../../src";
import { KVStorageFactory } from "../../src/kv/helpers";
import {
  DurableObjectFactory,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStub,
  DurableObjectsModule,
} from "../../src/modules/do";
import { Context } from "../../src/modules/module";
import { getObjectProperties, triggerPromise, useTmp, wait } from "../helpers";

// Test IDs are sha256("test") and sha256("test2")
const testId =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const testId2 =
  "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752";

const throws = () => {
  throw new Error("Function should not be called!");
};

function storedValue(data: any): KVStoredValue {
  return { value: Buffer.from(JSON.stringify(data), "utf8") };
}

// Durable Object that stores its constructed data and requests in storage
class TestDurableObject implements DurableObject {
  private static INSTANCE_COUNT = 0;
  private readonly instanceId: number;

  constructor(private state: DurableObjectState, env: Context) {
    this.instanceId = TestDurableObject.INSTANCE_COUNT++;
    void state.storage.put({
      id: state.id.toString(),
      env: env,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/instance") {
      return new Response(this.instanceId.toString());
    }

    let count = 0;
    await this.state.storage.transaction(async (txn) => {
      count = ((await txn.get<number>("requestCount")) ?? 0) + 1;
      await txn.put({
        [`request${count}`]: request.url,
        requestCount: count,
      });
    });
    return new Response(`${this.state.id}:request${count}:${request.url}`);
  }
}

test("DurableObjectId: toString: returns hex ID", (t) => {
  t.is(new DurableObjectId(testId).toString(), testId);
});
test("DurableObjectId: hides implementation details", (t) => {
  const id = new DurableObjectId(testId);
  t.deepEqual(getObjectProperties(id), ["name", "toString"]);
});

test("DurableObjectStub: name: returns ID's name if defined", (t) => {
  t.is(
    new DurableObjectStub(throws, new DurableObjectId(testId)).name,
    undefined
  );
  t.is(
    new DurableObjectStub(throws, new DurableObjectId(testId, "test")).name,
    "test"
  );
});
test("DurableObjectStub: fetch: creates and dispatches request to instance", async (t) => {
  let factoryCalls = 0;
  const factory: DurableObjectFactory = async (id) => {
    factoryCalls++;
    return {
      fetch: (request) =>
        new Response(`${id.toString()}:${request.method}:${request.url}`),
    };
  };
  const stub = new DurableObjectStub(factory, new DurableObjectId(testId));
  t.is(factoryCalls, 0);
  const res = await stub.fetch("http://localhost:8787/", { method: "POST" });
  t.is(factoryCalls, 1);
  t.is(await res.text(), `${testId}:POST:http://localhost:8787/`);
  // Check factory called for each fetch
  await stub.fetch("http://localhost:8787/");
  t.is(factoryCalls, 2);
});
test("DurableObjectStub: hides implementation details", (t) => {
  const stub = new DurableObjectStub(throws, new DurableObjectId(testId));
  t.deepEqual(getObjectProperties(stub), ["fetch", "id", "name", "storage"]);
});

test("DurableObjectNamespace: newUniqueId: generates unique IDs", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.newUniqueId().toString();
  const id2 = namespace.newUniqueId().toString();
  t.true(id1 !== id2);
  t.is(id1.length, 64);
  t.is(id2.length, 64);
  // Check first bits are 0
  t.is(Buffer.from(id1, "hex")[0] >> 7, 0);
  t.is(Buffer.from(id2, "hex")[0] >> 7, 0);
});
test("DurableObjectNamespace: idFromName: generates same ID for same name and object", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.idFromName("test").toString();
  const id2 = namespace.idFromName("test").toString();
  t.true(id1 === id2);
  t.is(id1.length, 64);
  // Check first bit is 1
  t.is(Buffer.from(id1, "hex")[0] >> 7, 1);
});
test("DurableObjectNamespace: idFromName: generates different IDs for different names but same objects", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.idFromName("test1").toString();
  const id2 = namespace.idFromName("test2").toString();
  t.true(id1 !== id2);
});
test("DurableObjectNamespace: idFromName: generates different IDs for same names but different objects", (t) => {
  const namespace1 = new DurableObjectNamespace("OBJECT1", throws);
  const namespace2 = new DurableObjectNamespace("OBJECT2", throws);
  const id1 = namespace1.idFromName("test").toString();
  const id2 = namespace2.idFromName("test").toString();
  t.true(id1 !== id2);
});
test("DurableObjectNamespace: idFromString: returns ID with same hex", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  t.is(namespace.idFromString(testId).toString(), testId);
});
test("DurableObjectNamespace: get: returns stub using namespace's factory", async (t) => {
  let factoryCalls = 0;
  const factory: DurableObjectFactory = async (id) => {
    factoryCalls++;
    return { fetch: () => new Response(id.toString()) };
  };
  const namespace = new DurableObjectNamespace("OBJECT", factory);
  const stub = namespace.get(new DurableObjectId(testId));
  const res = await stub.fetch("http://localhost:8787/");
  t.is(factoryCalls, 1);
  t.is(await res.text(), testId);
});
test("DurableObjectNamespace: hides implementation details", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  t.deepEqual(getObjectProperties(namespace), [
    "get",
    "idFromName",
    "idFromString",
    "newUniqueId",
  ]);
});

test("resetInstances: deletes all instances", async (t) => {
  const module = new DurableObjectsModule(new NoOpLog());
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  await ns.get(ns.idFromString(testId)).fetch("http://localhost:8787/");
  await ns.get(ns.idFromString(testId2)).fetch("http://localhost:8787/");
  t.is(module._instances.size, 2);
  module.resetInstances();
  t.is(module._instances.size, 0);
});
test("resetInstances: aborts all in-progress transactions", async (t) => {
  const [initTrigger, initPromise] = triggerPromise<void>();
  const [barrierTrigger, barrierPromise] = triggerPromise<void>();
  class Object implements DurableObject {
    constructor(private state: DurableObjectState) {
      initTrigger();
    }

    async fetch(): Promise<Response> {
      await this.state.storage.transaction(async (txn) => {
        await txn.put("key", "new");
        await barrierPromise;
      });
      return new Response();
    }
  }

  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const storage = storageFactory.getStorage(`OBJECT_${testId}`);
  await storage.put("key", storedValue("old"));

  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  module.setContext({ OBJECT: Object }, {});
  const ns = module.getNamespace("OBJECT");

  const stub = ns.get(ns.idFromString(testId));
  const res = stub.fetch("http://localhost:8787/put");

  // Make sure the instance is initialised...
  await initPromise;
  // ...then abort all, and allow the transaction to complete
  module.resetInstances();
  barrierTrigger();
  await res;

  t.deepEqual(await storage.get("key"), storedValue("old"));
});

test("getNamespace: can fetch from factory created instances", async (t) => {
  const module = new DurableObjectsModule(new NoOpLog());
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  const res = await ns
    .get(ns.idFromString(testId))
    .fetch("http://localhost:8787/");
  t.is(await res.text(), `${testId}:request1:http://localhost:8787/`);
});
test("getNamespace: factory creates instances with correct IDs and environment", async (t) => {
  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  module.setContext({ OBJECT: TestDurableObject }, { KEY: "value" });
  const ns = module.getNamespace("OBJECT");
  await ns.get(ns.idFromString(testId)).fetch("http://localhost:8787/");
  const storage = storageFactory.getStorage(`OBJECT_${testId}`);
  t.deepEqual(await storage.get("id"), storedValue(testId));
  t.deepEqual(await storage.get("env"), storedValue({ KEY: "value" }));
});
test("getNamespace: factory waits for context before creating instances", async (t) => {
  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  const ns = module.getNamespace("OBJECT");
  const storage = storageFactory.getStorage(`OBJECT_${testId}`);
  const promise = ns
    .get(ns.idFromString(testId))
    .fetch("http://localhost:8787/");
  await wait(500);
  t.is(await storage.get("id"), undefined);
  module.setContext({ OBJECT: TestDurableObject }, {});
  await promise;
  t.deepEqual(await storage.get("id"), storedValue(testId));
});
test("getNamespace: factory reuses existing instances", async (t) => {
  const module = new DurableObjectsModule(new NoOpLog());
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  const stub1 = ns.get(ns.idFromString(testId));
  const stub2 = ns.get(ns.idFromString(testId));
  const res1 = await stub1.fetch("http://localhost:8787/instance");
  const res2 = await stub2.fetch("http://localhost:8787/instance");
  t.true((await res1.text()) === (await res2.text()));
});
test("getNamespace: factory creates persistent storage at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new DurableObjectsModule(
    new NoOpLog(),
    new KVStorageFactory(tmp)
  );
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT", true);
  await ns.get(ns.idFromString(testId)).fetch("http://localhost:8787/");
  t.is(
    await fs.readFile(path.join(tmp, `OBJECT_${testId}`, "id"), "utf8"),
    JSON.stringify(testId)
  );
});
test("getNamespace: factory creates persistent storage at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new DurableObjectsModule(
    new NoOpLog(),
    new KVStorageFactory(tmpDefault)
  );
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT", tmpCustom);
  await ns.get(ns.idFromString(testId)).fetch("http://localhost:8787/");
  t.false(existsSync(path.join(tmpDefault, `OBJECT_${testId}`, "id")));
  t.is(
    await fs.readFile(path.join(tmpCustom, `OBJECT_${testId}`, "id"), "utf8"),
    JSON.stringify(testId)
  );
});
test("getNamespace: factory creates in-memory storage", async (t) => {
  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  await ns.get(ns.idFromString(testId)).fetch("http://localhost:8787/");
  t.false(existsSync(path.join(tmp, `OBJECT_${testId}`, "id")));
  const storage = storageFactory.getStorage(`OBJECT_${testId}`);
  t.deepEqual(await storage.get("id"), storedValue(testId));
});
test("getNamespace: factory reuses existing storage for in-memory storage", async (t) => {
  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  const res1 = await ns
    .get(ns.idFromString(testId))
    .fetch("http://localhost:8787/1");
  t.is(await res1.text(), `${testId}:request1:http://localhost:8787/1`);
  const res2 = await ns
    .get(ns.idFromString(testId))
    .fetch("http://localhost:8787/2");
  t.is(await res2.text(), `${testId}:request2:http://localhost:8787/2`);
  t.false(existsSync(path.join(tmp, `OBJECT_${testId}`, "id")));
  const storage = storageFactory.getStorage(`OBJECT_${testId}`);
  t.deepEqual(await storage.get("requestCount"), storedValue(2));
  t.deepEqual(
    await storage.get("request1"),
    storedValue("http://localhost:8787/1")
  );
  t.deepEqual(
    await storage.get("request2"),
    storedValue("http://localhost:8787/2")
  );
});
test("getNamespace: factory exposes instance storage", async (t) => {
  const module = new DurableObjectsModule(new NoOpLog());
  module.setContext({ OBJECT: TestDurableObject }, {});
  const ns = module.getNamespace("OBJECT");
  const stub = ns.get(ns.idFromString(testId));
  await (await stub.storage()).put("requestCount", 3);
  const res = await stub.fetch("http://localhost:8787/");
  t.is(await res.text(), `${testId}:request4:http://localhost:8787/`);
  t.is(await (await stub.storage()).get("requestCount"), 4);
});
test("getNamespace: factory throws if constructor not found", async (t) => {
  const module = new DurableObjectsModule(new NoOpLog());
  module.setContext({}, {});
  const ns = module.getNamespace("OBJECT");
  const stub = ns.get(ns.idFromString(testId));
  await t.throwsAsync(stub.fetch("http://localhost:8787/"), {
    instanceOf: MiniflareError,
    message: `Missing constructor for Durable Object OBJECT`,
  });
});

test("buildEnvironment: creates persistent storage at default location", async (t) => {
  const tmp = await useTmp(t);
  const module = new DurableObjectsModule(
    new NoOpLog(),
    new KVStorageFactory(tmp)
  );
  module.setContext(
    { OBJECT1: TestDurableObject, OBJECT2: TestDurableObject },
    {}
  );
  const environment = module.buildEnvironment({
    processedDurableObjects: [
      { name: "OBJECT1", className: "", scriptPath: "" },
      { name: "OBJECT2", className: "", scriptPath: "" },
    ],
    durableObjectsPersist: true,
  });
  t.true("OBJECT1" in environment);
  t.true("OBJECT2" in environment);
  await environment.OBJECT1.get(environment.OBJECT1.idFromString(testId)).fetch(
    "http://localhost:8787/"
  );
  await environment.OBJECT2.get(
    environment.OBJECT2.idFromString(testId2)
  ).fetch("http://localhost:8787/");
  t.is(
    await fs.readFile(path.join(tmp, `OBJECT1_${testId}`, "id"), "utf8"),
    JSON.stringify(testId)
  );
  t.is(
    await fs.readFile(path.join(tmp, `OBJECT2_${testId2}`, "id"), "utf8"),
    JSON.stringify(testId2)
  );
});
test("buildEnvironment: creates persistent storage at custom location", async (t) => {
  const tmpDefault = await useTmp(t);
  const tmpCustom = await useTmp(t);
  const module = new DurableObjectsModule(
    new NoOpLog(),
    new KVStorageFactory(tmpDefault)
  );
  module.setContext(
    { OBJECT1: TestDurableObject, OBJECT2: TestDurableObject },
    {}
  );
  const environment = module.buildEnvironment({
    processedDurableObjects: [
      { name: "OBJECT1", className: "", scriptPath: "" },
      { name: "OBJECT2", className: "", scriptPath: "" },
    ],
    durableObjectsPersist: tmpCustom,
  });
  t.true("OBJECT1" in environment);
  t.true("OBJECT2" in environment);
  await environment.OBJECT1.get(environment.OBJECT1.idFromString(testId)).fetch(
    "http://localhost:8787/"
  );
  await environment.OBJECT2.get(
    environment.OBJECT2.idFromString(testId2)
  ).fetch("http://localhost:8787/");
  t.false(existsSync(path.join(tmpDefault, `OBJECT1_${testId}`, "id")));
  t.false(existsSync(path.join(tmpDefault, `OBJECT2_${testId2}`, "id")));
  t.is(
    await fs.readFile(path.join(tmpCustom, `OBJECT1_${testId}`, "id"), "utf8"),
    JSON.stringify(testId)
  );
  t.is(
    await fs.readFile(path.join(tmpCustom, `OBJECT2_${testId2}`, "id"), "utf8"),
    JSON.stringify(testId2)
  );
});
test("buildEnvironment: creates in-memory storage", async (t) => {
  const tmp = await useTmp(t);
  const storageFactory = new KVStorageFactory(tmp);
  const module = new DurableObjectsModule(new NoOpLog(), storageFactory);
  module.setContext(
    { OBJECT1: TestDurableObject, OBJECT2: TestDurableObject },
    {}
  );
  const environment = module.buildEnvironment({
    processedDurableObjects: [
      { name: "OBJECT1", className: "", scriptPath: "" },
      { name: "OBJECT2", className: "", scriptPath: "" },
    ],
    durableObjectsPersist: false,
  });
  t.true("OBJECT1" in environment);
  t.true("OBJECT2" in environment);
  await environment.OBJECT1.get(environment.OBJECT1.idFromString(testId)).fetch(
    "http://localhost:8787/"
  );
  await environment.OBJECT2.get(
    environment.OBJECT2.idFromString(testId2)
  ).fetch("http://localhost:8787/");
  t.false(existsSync(path.join(tmp, `OBJECT1_${testId}`, "id")));
  t.false(existsSync(path.join(tmp, `OBJECT2_${testId2}`, "id")));
  const storage1 = storageFactory.getStorage(`OBJECT1_${testId}`);
  const storage2 = storageFactory.getStorage(`OBJECT2_${testId2}`);
  t.deepEqual(await storage1.get("id"), storedValue(testId));
  t.deepEqual(await storage2.get("id"), storedValue(testId2));
});

const doScriptPath = path.resolve(__dirname, "..", "fixtures", "do.js");
const doScript2Path = path.resolve(__dirname, "..", "fixtures", "do2.js");

test("buildEnvironment: can fetch from instances", async (t) => {
  const mf = new Miniflare({
    scriptPath: doScriptPath,
    modules: true,
    durableObjects: { OBJECT1: "Object1" },
  });
  const res = await mf.dispatchFetch("http://localhost:8787/1");
  t.is(await res.text(), "1");
});
test("buildEnvironment: can use instance storage", async (t) => {
  const tmp = await useTmp(t);
  const mf = new Miniflare({
    scriptPath: doScriptPath,
    modules: true,
    durableObjects: { OBJECT1: "Object1" },
    durableObjectsPersist: tmp,
  });
  await mf.dispatchFetch("http://localhost:8787/1");
  const ns = await mf.getDurableObjectNamespace("OBJECT1");
  const storage = await ns.get(ns.idFromString(testId)).storage();
  t.is(await storage.get("request1"), "http://localhost:8787/1");
});
test("buildEnvironment: can create instances from classes in multiple files", async (t) => {
  const tmp = await useTmp(t);
  const mf = new Miniflare({
    scriptPath: doScriptPath,
    modules: true,
    durableObjects: {
      OBJECT1: "Object1",
      OBJECT2: { className: "Object2", scriptPath: doScript2Path },
    },
    durableObjectsPersist: tmp,
  });
  const res1 = await mf.dispatchFetch("http://localhost:8787/1");
  const res2 = await mf.dispatchFetch("http://localhost:8787/2");
  t.is(await res1.text(), "1");
  t.is(await res2.text(), "2");
  const ns1 = await mf.getDurableObjectNamespace("OBJECT1");
  const ns2 = await mf.getDurableObjectNamespace("OBJECT2");
  const storage1 = await ns1.get(ns1.idFromString(testId)).storage();
  const storage2 = await ns2.get(ns2.idFromString(testId)).storage();
  t.is(await storage1.get("request1"), "http://localhost:8787/1");
  t.is(await storage2.get("request2"), "http://localhost:8787/2");
});
