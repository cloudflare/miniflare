import assert from "assert";
import { deserialize } from "v8";
import { Request, Response } from "@miniflare/core";
import {
  DurableObject,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import { Compatibility } from "@miniflare/shared";
import {
  MemoryStorageFactory,
  NoOpLog,
  getObjectProperties,
  triggerPromise,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import { WebSocketPair } from "@miniflare/web-sockets";
import test, { ThrowsExpectation } from "ava";
import { TestObject, testId, testIdHex } from "./object";

const log = new NoOpLog();
const compat = new Compatibility();

const throws = (): never => {
  throw new Error("Function should not be called!");
};

function getTestObjectNamespace(): [
  DurableObjectNamespace,
  DurableObjectsPlugin,
  MemoryStorageFactory
] {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(log, compat, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});
  return [plugin.getNamespace(factory, "TEST"), plugin, factory];
}

test("DurableObjectId: name: exposes instance name", (t) => {
  t.is(testId.name, "instance");
});
test("DurableObjectId: equals: checks if hex IDs are equal", (t) => {
  const testId2 = new DurableObjectId("Test", testIdHex);
  t.true(testId.equals(testId2));
});
test("DurableObjectId: equals: returns false if other is not DurableObjectId", (t) => {
  // @ts-expect-error intentionally testing incorrect types
  t.false(testId.equals(testIdHex));
});
test("DurableObjectId: toString: returns hex ID", (t) => {
  t.is(testId.toString(), testIdHex);
});
test("DurableObjectId: hides implementation details", (t) => {
  t.deepEqual(getObjectProperties(testId), ["equals", "name", "toString"]);
});

test("DurableObjectState: waitUntil: does nothing", (t) => {
  const storage = new DurableObjectStorage(new MemoryStorage());
  const state = new DurableObjectState(testId, storage);
  state.waitUntil(Promise.resolve());
  t.pass();
});
test("DurableObjectState: blockConcurrencyWhile: prevents fetch events dispatch to object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(log, compat, {
    durableObjects: { TEST: "TestObject" },
  });
  const [trigger, promise] = triggerPromise<void>();
  const events: number[] = [];

  class TestObject implements DurableObject {
    constructor(state: DurableObjectState) {
      state.blockConcurrencyWhile(async () => {
        events.push(1);
        await promise;
        events.push(2);
      });
    }

    fetch(): Response {
      events.push(3);
      return new Response("body");
    }
  }
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});

  const ns = plugin.getNamespace(factory, "TEST");
  const fetchPromise = ns.get(ns.newUniqueId()).fetch("http://localhost");
  trigger();
  await fetchPromise;
  t.deepEqual(events, [1, 2, 3]);
});
test("DurableObjectState: kFetch: waits for writes to be confirmed before returning", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(log, compat, {
    durableObjects: { TEST: "TestObject" },
  });

  class TestObject implements DurableObject {
    constructor(private readonly state: DurableObjectState) {}

    fetch(): Response {
      this.state.storage.put("key", "value");
      return new Response("body");
    }
  }
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});

  const ns = plugin.getNamespace(factory, "TEST");
  const id = ns.newUniqueId();
  await ns.get(id).fetch("http://localhost");
  const storage = factory.storage(`TEST:${id.toString()}`);
  const value = (await storage.get("key"))?.value;
  assert(value);
  t.is(deserialize(value), "value");
});
test("DurableObjectState: hides implementation details", async (t) => {
  const [ns, plugin, factory] = getTestObjectNamespace();
  const state = await plugin.getObject(factory, ns.newUniqueId());
  t.deepEqual(getObjectProperties(state), [
    "blockConcurrencyWhile",
    "id",
    "storage",
    "waitUntil",
  ]);
});

test("DurableObjectStub: name: returns ID's name if defined", async (t) => {
  t.is(
    new DurableObjectStub(throws, new DurableObjectId("Test", testIdHex)).name,
    undefined
  );
  t.is(new DurableObjectStub(throws, testId).name, "instance");
});
test("DurableObjectStub: fetch: creates and dispatches request to instance", async (t) => {
  const [ns] = getTestObjectNamespace();
  const stub = ns.get(testId);
  let res = await stub.fetch("http://localhost:8787/", { method: "POST" });
  t.is(await res.text(), `${testId}:request1:POST:http://localhost:8787/`);
  res = await stub.fetch(
    new Request("http://localhost:8787/path", { method: "PUT" })
  );
  t.is(await res.text(), `${testId}:request2:PUT:http://localhost:8787/path`);
});
test("DurableObjectStub: fetch: resolves relative urls with respect to https://fake-host", async (t) => {
  const [ns] = getTestObjectNamespace();
  const stub = ns.get(testId);
  const res = await stub.fetch("test");
  t.is(await res.text(), `${testId}:request1:GET:https://fake-host/test`);
});
test("DurableObjectStub: fetch: passes through web socket requests", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(log, compat, {
    durableObjects: { TEST: "TestObject" },
  });

  const [dataTrigger, dataPromise] = triggerPromise<string | ArrayBuffer>();
  class TestObject implements DurableObject {
    fetch(): Response {
      const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
      webSocket2.accept();
      webSocket2.addEventListener("message", (e) => dataTrigger(e.data));
      return new Response(null, {
        status: 101,
        webSocket: webSocket1,
      });
    }
  }
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});

  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost");
  const webSocket = res.webSocket;
  assert(webSocket);
  webSocket.accept();
  webSocket.send("test message");
  t.is(await dataPromise, "test message");
});
test("DurableObjectStub: hides implementation details", async (t) => {
  const [ns] = getTestObjectNamespace();
  const stub = ns.get(testId);
  t.deepEqual(getObjectProperties(stub), ["fetch", "id", "name"]);
});

test("DurableObjectNamespace: newUniqueId: generates unique IDs", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.newUniqueId();
  const id2 = namespace.newUniqueId();
  t.not(id1.toString(), id2.toString());
  t.is(id1.toString().length, 64);
  t.is(id2.toString().length, 64);
  // Check first bits are 0
  t.is(Buffer.from(id1.toString(), "hex")[0] >> 7, 0);
  t.is(Buffer.from(id2.toString(), "hex")[0] >> 7, 0);
  // Check the IDs are valid for this object
  namespace.get(id1);
  namespace.get(id2);
});
test("DurableObjectNamespace: newUniqueId: IDs tied to generating object", (t) => {
  const namespace1 = new DurableObjectNamespace("OBJECT1", throws);
  const namespace2 = new DurableObjectNamespace("OBJECT2", throws);
  const id1 = namespace1.newUniqueId();
  t.throws(() => namespace2.get(id1), {
    instanceOf: TypeError,
    message: "ID is not for this Durable Object class.",
  });
});
test("DurableObjectNamespace: idFromName: generates same ID for same name and object", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.idFromName("test");
  const id2 = namespace.idFromName("test");
  t.is(id1.toString(), id2.toString());
  t.is(id1.toString().length, 64);
  // Check first bit is 1
  t.is(Buffer.from(id1.toString(), "hex")[0] >> 7, 1);
  // Check the ID is valid for this object
  namespace.get(id1);
});
test("DurableObjectNamespace: idFromName: generates different IDs for different names but same objects", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const id1 = namespace.idFromName("test1");
  const id2 = namespace.idFromName("test2");
  t.not(id1.toString(), id2.toString());
  // Check the IDs are valid for this object
  namespace.get(id1);
  namespace.get(id2);
});
test("DurableObjectNamespace: idFromName: generates different IDs for same names but different objects", (t) => {
  const namespace1 = new DurableObjectNamespace("OBJECT1", throws);
  const namespace2 = new DurableObjectNamespace("OBJECT2", throws);
  const id1 = namespace1.idFromName("test");
  const id2 = namespace2.idFromName("test");
  t.not(id1.toString(), id2.toString());
  // Check the IDs are valid for their corresponding objects
  namespace1.get(id1);
  namespace2.get(id2);
});
test("DurableObjectNamespace: idFromName: IDs tied to generating object", (t) => {
  const namespace1 = new DurableObjectNamespace("OBJECT1", throws);
  const namespace2 = new DurableObjectNamespace("OBJECT2", throws);
  const id1 = namespace1.idFromName("test");
  t.throws(() => namespace2.get(id1), {
    instanceOf: TypeError,
    message: "ID is not for this Durable Object class.",
  });
});
test("DurableObjectNamespace: idFromString: returns ID with same hex", (t) => {
  const namespace = new DurableObjectNamespace("TEST", throws);
  const id = namespace.idFromString(testIdHex);
  t.is(id.toString(), testIdHex);
  // Check the ID is valid for this object
  namespace.get(id);
});
test("DurableObjectNamespace: idFromString: requires 64 hex digits", (t) => {
  const namespace = new DurableObjectNamespace("OBJECT", throws);
  const expectation: ThrowsExpectation = {
    instanceOf: TypeError,
    message:
      "Invalid Durable Object ID. Durable Object IDs must be 64 hex digits.",
  };
  // Check with non-hex digits
  t.throws(
    () =>
      namespace.idFromString(
        "not a hex id, but this is carefully crafted to be 64 characters!"
      ),
    expectation
  );
  // Check with not enough hex digits
  t.throws(() => namespace.idFromString("abc"), expectation);
});
test("DurableObjectNamespace: idFromString: IDs tied to generating object", (t) => {
  const namespace1 = new DurableObjectNamespace("OBJECT", throws);
  const namespace2 = new DurableObjectNamespace("TEST", throws);
  // Check with hex string from another object
  t.throws(() => namespace1.idFromString(testIdHex), {
    instanceOf: TypeError,
    message:
      "Invalid Durable Object ID. The ID does not match this Durable Object class.",
  });

  // Check with DurableObjectId instance from another object
  const id = namespace2.idFromString(testIdHex);
  t.throws(() => namespace1.get(id), {
    instanceOf: TypeError,
    message: "ID is not for this Durable Object class.",
  });
});
test("DurableObjectNamespace: get: returns stub using namespace's factory", async (t) => {
  const [ns] = getTestObjectNamespace();
  const stub = ns.get(testId);
  const res = await stub.fetch("http://localhost:8787/");
  t.is(await res.text(), `${testId}:request1:GET:http://localhost:8787/`);
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
