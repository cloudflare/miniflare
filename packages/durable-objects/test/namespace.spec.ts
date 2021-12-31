import assert from "assert";
import { URL } from "url";
import { deserialize } from "v8";
import { CachePlugin } from "@miniflare/cache";
import {
  BindingsPlugin,
  CorePlugin,
  MiniflareCore,
  Request,
  Response,
  fetch,
} from "@miniflare/core";
import {
  DurableObject,
  DurableObjectError,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  StorageFactory,
  getRequestContext,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  RecorderStorage,
  TestLog,
  getObjectProperties,
  triggerPromise,
  useMiniflare,
  useServer,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import { WebSocketPair } from "@miniflare/web-sockets";
import test, { ThrowsExpectation } from "ava";
import { Request as BaseRequest } from "undici";
import { TestObject, testId, testIdHex } from "./object";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const ctx: PluginContext = { log, compat, rootPath };

const throws = (): never => {
  throw new Error("Function should not be called!");
};

function getTestObjectNamespace(): [
  DurableObjectNamespace,
  DurableObjectsPlugin,
  MemoryStorageFactory
] {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
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
  const plugin = new DurableObjectsPlugin(ctx, {
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
  plugin.reload({}, { TestObject }, new Map());

  const ns = plugin.getNamespace(factory, "TEST");
  const fetchPromise = ns.get(ns.newUniqueId()).fetch("http://localhost");
  trigger();
  await fetchPromise;
  t.deepEqual(events, [1, 2, 3]);
});
test("DurableObjectState: kFetch: waits for writes to be confirmed before returning", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
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
  plugin.reload({}, { TestObject }, new Map());

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
test("DurableObjectStub: fetch: resolves relative urls with respect to https://fake-host by default", async (t) => {
  const [ns] = getTestObjectNamespace();
  const stub = ns.get(testId);
  const res = await stub.fetch("test");
  t.is(await res.text(), `${testId}:request1:GET:https://fake-host/test`);
});
test("DurableObjectStub: fetch: throws with relative urls if compatibility flag enabled", async (t) => {
  const compat = new Compatibility(undefined, [
    "durable_object_fetch_requires_full_url",
  ]);
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(
    { log, compat, rootPath },
    { durableObjects: { TEST: "TestObject" } }
  );
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const ns = plugin.getNamespace(factory, "TEST");
  const stub = ns.get(testId);
  await t.throwsAsync(stub.fetch("test"), {
    instanceOf: TypeError,
    message: "Invalid URL",
  });
  // Check can still fetch with full urls
  const res = await stub.fetch("https://fake-host/test");
  t.is(await res.text(), `${testId}:request1:GET:https://fake-host/test`);
});
test("DurableObjectStub: fetch: throws with unknown protocols if compatibility flag enabled", async (t) => {
  const compat = new Compatibility(undefined, [
    "fetch_refuses_unknown_protocols",
  ]);
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(
    { log, compat, rootPath },
    { durableObjects: { TEST: "TestObject" } }
  );
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const ns = plugin.getNamespace(factory, "TEST");
  const stub = ns.get(testId);
  await t.throwsAsync(stub.fetch("test://host.com/"), {
    instanceOf: TypeError,
    message: "Fetch API cannot load: test://host.com/",
  });
  // Check can still fetch with known protocols and all request types
  // noinspection HttpUrlsUsage
  await stub.fetch("http://host.com/");
  await stub.fetch("https://host.com/");
  await stub.fetch(new URL("https://host.com/"));
  await stub.fetch(new Request("https://host.com/"));
  await stub.fetch(new BaseRequest("https://host.com/"));
});
test("DurableObjectStub: fetch: logs warning with unknown protocol if compatibility flag disabled", async (t) => {
  const log = new TestLog();
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(
    { log, compat, rootPath },
    { durableObjects: { TEST: "TestObject" } }
  );
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const ns = plugin.getNamespace(factory, "TEST");
  const stub = ns.get(testId);
  const res = await stub.fetch("test://host.com/");
  t.is(await res.text(), `${testIdHex}:request1:GET:test://host.com/`);

  // Check warning logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 1);
  t.regex(
    warnings[0],
    /URLs passed to fetch\(\) must begin with either 'http:' or 'https:', not 'test:'/
  );
});
test("DurableObjectStub: fetch: passes through web socket requests", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
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
  plugin.reload({}, { TestObject }, new Map());

  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost");
  const webSocket = res.webSocket;
  assert(webSocket);
  webSocket.accept();
  webSocket.send("test message");
  t.is(await dataPromise, "test message");
});
test("DurableObjectStub: fetch: creates new request context", async (t) => {
  const storageFactory = new MemoryStorageFactory();
  const scriptRunner = new VMScriptRunner();
  const mf = new MiniflareCore(
    { CorePlugin, BindingsPlugin, CachePlugin, DurableObjectsPlugin },
    { log, storageFactory, scriptRunner },
    {
      bindings: {
        assertSubrequests(expected: number) {
          t.is(getRequestContext()?.subrequests, expected);
        },
      },
      durableObjects: { TEST_OBJECT: "TestObject" },
      modules: true,
      script: `
export default {
  async fetch(request, env, ctx) {
    env.assertSubrequests(0);
    await caches.default.match("http://localhost/");
    env.assertSubrequests(1);
    
    const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.newUniqueId());
    return await stub.fetch(request);
  }
}

export class TestObject {
  constructor(state, env) {
    this.env = env;
  }

  async fetch(request) {
    this.env.assertSubrequests(0);
    await caches.default.match("http://localhost/");
    this.env.assertSubrequests(1);
    
    const n = parseInt(new URL(request.url).searchParams.get("n"));
    await Promise.all(
      Array.from(Array(n)).map(() => caches.default.match("http://localhost/"))
    );
    return new Response("body");
  }
}
`,
    }
  );
  await t.throwsAsync(mf.dispatchFetch("http://localhost/?n=50"), {
    instanceOf: Error,
    message: /^Too many subrequests/,
  });
  const res = await mf.dispatchFetch("http://localhost/?n=1");
  t.is(await res.text(), "body");
});
test("DurableObjectStub: fetch: increases request depth", async (t) => {
  const depths: [request: number, pipeline: number][] = [];
  const mf = useMiniflare(
    { BindingsPlugin, DurableObjectsPlugin },
    {
      bindings: {
        recordDepth() {
          const ctx = getRequestContext()!;
          depths.push([ctx.requestDepth, ctx.pipelineDepth]);
        },
      },
      modules: true,
      durableObjects: { TEST_OBJECT: "TestObject" },
      script: `export class TestObject {
        constructor(state, env) {
          this.env = env;
        }
        async fetch(request) {
          this.env.recordDepth();
          
          const url = new URL(request.url);
          const n = parseInt(url.searchParams.get("n") ?? "0");
          if (n === 0) return new Response("end");
          url.searchParams.set("n", n - 1);
          
          const id = this.env.TEST_OBJECT.idFromName("a");
          const stub = this.env.TEST_OBJECT.get(id);
          const res = await stub.fetch(url);
          return new Response(\`\${n},\${await res.text()}\`);
        }
      }
      
      export default {
        async fetch(request, env) {
          env.recordDepth();
          const id = env.TEST_OBJECT.idFromName("a");
          const stub = env.TEST_OBJECT.get(id);
          const res = await stub.fetch(request);
          return new Response(\`entry,\${await res.text()}\`);
        }
      }
      `,
    }
  );

  const res = await mf.dispatchFetch("http://localhost/?n=3");
  t.is(await res.text(), "entry,3,2,1,end");
  t.deepEqual(depths, [
    [1, 1], // entry
    [2, 1], // object: ?n=3
    [3, 1], // object: ?n=2
    [4, 1], // object: ?n=1
    [5, 1], // object: ?n=0
  ]);

  await mf.dispatchFetch("http://localhost/?n=14"); // Shouldn't throw
  // ?n=15 throws not 16, because the entry counts as one request too
  await t.throwsAsync(mf.dispatchFetch("http://localhost/?n=15"), {
    instanceOf: Error,
    message:
      /^Subrequest depth limit exceeded.+\nWorkers and objects can recurse up to 16 times\./,
  });
});
test("DurableObjectStub: fetch: creates new pipeline", async (t) => {
  const depths: [request: number, pipeline: number][] = [];
  // noinspection JSUnusedGlobalSymbols
  const bindings = {
    recordDepth() {
      const ctx = getRequestContext()!;
      depths.push([ctx.requestDepth, ctx.pipelineDepth]);
    },
  };
  const mf = useMiniflare(
    { BindingsPlugin, DurableObjectsPlugin },
    {
      bindings,
      modules: true,
      durableObjects: { TEST_OBJECT: "TestObject" },
      serviceBindings: { SERVICE: "service" },
      mounts: {
        service: {
          bindings,
          modules: true,
          script: `export default {
            fetch(request, env) {
              env.recordDepth();
              return new Response("service");
            },
          }`,
        },
      },
      script: `export class TestObject {
        constructor(state, env) {
          this.env = env;
        }
        async fetch(request) {
          this.env.recordDepth();
          const res = await this.env.SERVICE.fetch(request);
          return new Response(\`object,\${await res.text()}\`);
        }
      }
      
      export default {
        async fetch(request, env) {
          env.recordDepth();
          const id = env.TEST_OBJECT.newUniqueId();
          const stub = env.TEST_OBJECT.get(id);
          const res = await stub.fetch(request);
          return new Response(\`entry,\${await res.text()}\`);
        }
      }
      `,
    }
  );
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "entry,object,service");
  t.deepEqual(depths, [
    [1, 1], // entry
    [2, 1], // object, increments just request depth
    [2, 2], // service, increments just pipeline depth
  ]);
});
test("DurableObjectStub: fetch: throws if handler doesn't return Response", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });

  class TestObject implements DurableObject {
    fetch(): Response {
      return "definitely a response" as any;
    }
  }
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());

  const ns = plugin.getNamespace(factory, "TEST");
  const stub = ns.get(testId);
  await t.throwsAsync(stub.fetch("http://localhost"), {
    instanceOf: DurableObjectError,
    code: "ERR_RESPONSE_TYPE",
    message:
      "Durable Object fetch handler didn't respond with a Response object",
  });
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

// Examples below adapted from:
// https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/

class ExampleDurableObject implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async getUniqueNumber(): Promise<number> {
    const val = (await this.state.storage.get<number>("counter")) ?? 0;
    await this.state.storage.put("counter", val + 1);
    return val;
  }

  async task(upstream: string): Promise<number> {
    await fetch(upstream);
    return await this.getUniqueNumber();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/unique") {
      return new Response((await this.getUniqueNumber()).toString());
    }
    if (url.pathname === "/tasks") {
      const upstream = await request.text();
      const promise1 = this.task(upstream);
      const promise2 = this.task(upstream);
      const val1 = await promise1;
      const val2 = await promise2;
      return new Response(JSON.stringify([val1, val2]));
    }
    if (url.pathname === "/coalesce") {
      // noinspection ES6MissingAwait
      void this.state.storage.put("foo", "value");
      // noinspection ES6MissingAwait
      void this.state.storage.delete("foo");
    }
    return new Response(null, { status: 404 });
  }
}

function getExampleObjectStub(): DurableObjectStub {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { EXAMPLE: "ExampleDurableObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { ExampleDurableObject }, new Map());
  const ns = plugin.getNamespace(factory, "EXAMPLE");
  return ns.get(ns.newUniqueId());
}

test("gets unique numbers", async (t) => {
  const stub = getExampleObjectStub();
  const [res1, res2, res3] = await Promise.all([
    stub.fetch("/unique"),
    stub.fetch("/unique"),
    stub.fetch("/unique"),
  ]);
  const [val1, val2, val3] = await Promise.all([
    res1.text(),
    res2.text(),
    res3.text(),
  ]);
  t.is(val1, "0");
  t.is(val2, "1");
  t.is(val3, "2");
});
test("gets unique numbers with fetch", async (t) => {
  // Return both fetches at the same time, once they've both been sent
  let remaining = 2;
  const [trigger, promise] = triggerPromise<void>();
  const { http: upstream } = await useServer(t, async (req, res) => {
    if (--remaining === 0) trigger();
    await promise;
    res.end("upstream");
  });
  const stub = getExampleObjectStub();
  const res = await stub.fetch("/tasks", {
    method: "POST",
    body: upstream.toString(),
  });
  const numbers = JSON.parse(await res.text()).sort();
  t.deepEqual(numbers, [0, 1]);
});
test("writes are coalesced", async (t) => {
  const storage = new RecorderStorage(new MemoryStorage());
  const storageFactory: StorageFactory = { storage: () => storage };

  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { EXAMPLE: "ExampleDurableObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { ExampleDurableObject }, new Map());
  const ns = plugin.getNamespace(storageFactory, "EXAMPLE");

  const stub = ns.get(ns.newUniqueId());
  await stub.fetch("/coalesce");
  // delete and put should coalesce
  t.deepEqual(storage.events, [{ type: "deleteMany", keys: ["foo"] }]);
});
