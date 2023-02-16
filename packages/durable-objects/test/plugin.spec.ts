import assert from "assert";
import path from "path";
import { setImmediate, setTimeout } from "timers/promises";
import { Response } from "@miniflare/core";
import {
  DurableObject,
  DurableObjectError,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  Mount,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  StoredValue,
  StoredValueMeta,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  triggerPromise,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";
import { TestObject, testId } from "./object";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx = (): PluginContext => ({
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: new Map(), // New `sharedCache` for each `ctx` returned
});
test("DurableObjectsPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(DurableObjectsPlugin, [
    "--do",
    "OBJECT1=Object1",
    "--do",
    "OBJECT2=Object2@api",
    "--do-persist",
    "path",
    "--no-do-alarms",
  ]);
  t.deepEqual(options, {
    durableObjects: {
      OBJECT1: "Object1",
      OBJECT2: { className: "Object2", scriptName: "api" },
    },
    durableObjectsPersist: "path",
    durableObjectsAlarms: false,
  });
  options = parsePluginArgv(DurableObjectsPlugin, [
    "-o",
    "OBJECT1=Object1",
    "-o",
    "OBJECT2=Object2@api",
    "--do-persist",
  ]);
  t.deepEqual(options, {
    durableObjects: {
      OBJECT1: "Object1",
      OBJECT2: { className: "Object2", scriptName: "api" },
    },
    durableObjectsPersist: true,
  });
});
test("DurableObjectsPlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(DurableObjectsPlugin, {
    durable_objects: {
      bindings: [
        { name: "OBJECT1", class_name: "Object1" },
        { name: "OBJECT2", class_name: "Object2", script_name: "other_script" },
      ],
    },
    miniflare: {
      durable_objects_persist: "path",
      durable_objects_alarms: false,
    },
  });
  t.deepEqual(options, {
    durableObjects: {
      OBJECT1: { className: "Object1", scriptName: undefined },
      OBJECT2: { className: "Object2", scriptName: "other_script" },
    },
    durableObjectsPersist: "path",
    durableObjectsAlarms: false,
  });
});
test("DurableObjectsPlugin: logs options", (t) => {
  const logs = logPluginOptions(DurableObjectsPlugin, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: "Object2" },
    durableObjectsPersist: true,
    durableObjectsAlarms: true,
  });
  t.deepEqual(logs, [
    "Durable Objects: OBJECT1, OBJECT2",
    "Durable Objects Persistence: true",
    "Durable Object Alarms: true",
  ]);
});

test("DurableObjectPlugin: getStorage: reuses single instance of storage", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  const storage1 = plugin.getStorage(factory, testId);
  const storage2 = plugin.getStorage(factory, testId);
  t.is(storage1, storage2);
  await storage1.put("count", 5);

  // Check getObject() reuses the same instance
  plugin.reload({}, { TestObject }, new Map());
  const state = await plugin.getObject(factory, testId);
  t.is(state.storage, storage1);

  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost/");
  // 6 is previously stored value + 1
  t.is(await res.text(), `${testId.toString()}:request6:GET:http://localhost/`);
});
test("DurableObjectPlugin: getStorage: doesn't construct Durable Object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  class TestObject implements DurableObject {
    constructor() {
      t.fail();
    }
    fetch() {
      return assert.fail();
    }
  }
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  plugin.getStorage(factory, testId);
  t.pass();
});
test("DurableObjectPlugin: getStorage: allows setting alarms", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  const [alarmTrigger, alarmPromise] = triggerPromise<DurableObjectId>();
  class TestObject implements DurableObject {
    constructor(private readonly state: DurableObjectState) {}
    fetch() {
      return assert.fail();
    }
    alarm() {
      alarmTrigger(this.state.id);
    }
  }
  await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const storage = plugin.getStorage(factory, testId);
  await storage.setAlarm(Date.now());
  t.is((await alarmPromise).toString(), testId.toString());
});

test("DurableObjectsPlugin: getObject: waits for constructors and bindings", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  const promise = plugin.getObject(factory, testId);
  await setImmediate();
  t.is(factory.storages.size, 0);
  plugin.reload({}, { TestObject }, new Map());
  await promise;
  t.is(factory.storages.size, 1);
});
test("DurableObjectsPlugin: getObject: object storage is namespaced by object name", async (t) => {
  const map = new Map<string, StoredValue>();
  const factory = new MemoryStorageFactory({
    [`test://map:TEST:${testId.toString()}`]: map,
  });
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
    durableObjectsPersist: "test://map",
  });
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const state = await plugin.getObject(factory, testId);
  await state.storage.put("key", "value");
  t.true(map.has("key"));
});
test("DurableObjectsPlugin: getObject: resolves persist path relative to rootPath", async (t) => {
  const tmp = await useTmp(t);
  const map = new Map<string, StoredValue>();
  const factory = new MemoryStorageFactory({
    [`${tmp}${path.sep}test:TEST:${testId.toString()}`]: map,
  });
  const plugin = new DurableObjectsPlugin(
    { ...ctx(), rootPath: tmp },
    {
      durableObjects: { TEST: "TestObject" },
      durableObjectsPersist: "test",
    }
  );
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const state = await plugin.getObject(factory, testId);
  await state.storage.put("key", "value");
  t.true(map.has("key"));
});
test("DurableObjectsPlugin: getObject: reuses single instance of object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const [object1, object2] = await Promise.all([
    plugin.getObject(factory, testId),
    plugin.getObject(factory, testId),
  ]);
  t.is(object1, object2);
});

test("DurableObjectsPlugin: getNamespace: creates namespace for object, creating instances with correct ID and environment", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  plugin.reload({ KEY: "value" }, { TestObject }, new Map());
  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost/");
  t.is(await res.text(), `${testId.toString()}:request1:GET:http://localhost/`);
  const state = await plugin.getObject(factory, testId);
  t.is(await state.storage.get("id"), testId.toString());
  t.deepEqual(await state.storage.get("env"), { KEY: "value" });
});
test("DurableObjectsPlugin: getNamespace: creates namespace for object in mounted script", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: { className: "TestObject", scriptName: "test" } },
  });
  await plugin.beforeReload();
  const mounts = new Map<string, Mount>([
    ["test", { moduleExports: { TestObject }, usageModel: "bundled" }],
  ]);
  plugin.reload({}, {}, mounts);
  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost/");
  t.is(await res.text(), `${testId.toString()}:request1:GET:http://localhost/`);
});
test("DurableObjectsPlugin: getNamespace: reuses single instance of object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  plugin.reload({ KEY: "value" }, { TestObject }, new Map());
  const ns = plugin.getNamespace(factory, "TEST");
  const [res1, res2] = await Promise.all([
    ns.get(testId).fetch("http://localhost:8787/instance"),
    ns.get(testId).fetch("http://localhost:8787/instance"),
  ]);
  t.is(await res1.text(), await res2.text());
});
test("DurableObjectsPlugin: setup: includes namespaces for all objects", async (t) => {
  class Object1 implements DurableObject {
    fetch = () => new Response("object1");
    alarm = () => {};
  }
  class Object2 implements DurableObject {
    fetch = () => new Response("object2");
    alarm = () => {};
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { OBJECT1: "Object1", OBJECT2: { className: "Object2" } },
  });

  const result = await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { Object1, Object2 }, new Map());

  const ns1: DurableObjectNamespace = result.bindings?.OBJECT1;
  const ns2: DurableObjectNamespace = result.bindings?.OBJECT2;
  const res1 = await ns1.get(ns1.newUniqueId()).fetch("/");
  const res2 = await ns2.get(ns2.newUniqueId()).fetch("/");
  t.is(await res1.text(), "object1");
  t.is(await res2.text(), "object2");
});
test("DurableObjectsPlugin: setup: name removed from id passed to object constructors", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/219
  class TestObject implements DurableObject {
    constructor(readonly state: DurableObjectState) {}
    fetch = () => new Response(String(this.state.id.name));
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST_OBJECT: "TestObject" },
  });

  const result = await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());

  const ns: DurableObjectNamespace = result.bindings?.TEST_OBJECT;
  const id = ns.idFromName("name");
  t.is(id.name, "name");
  const stub = ns.get(id);
  t.is(stub.id.name, "name");
  const res = await stub.fetch("/");
  t.is(await res.text(), "undefined");
});

test("DurableObjectsPlugin: recreates instances when reload cache cleared", async (t) => {
  const factory = new MemoryStorageFactory();
  const pluginCtx = ctx();
  const plugin = new DurableObjectsPlugin(pluginCtx, {
    durableObjects: { TEST: "TestObject" },
  });
  await plugin.beforeReload();
  pluginCtx.sharedCache.clear();
  plugin.reload({}, { TestObject }, new Map());
  let ns = plugin.getNamespace(factory, "TEST");
  const res1 = await ns.get(testId).fetch("http://localhost:8787/instance");

  await plugin.beforeReload();
  pluginCtx.sharedCache.clear();
  plugin.reload({}, { TestObject }, new Map());
  ns = plugin.getNamespace(factory, "TEST");
  const res2 = await ns.get(testId).fetch("http://localhost:8787/instance");

  // Check new instance created
  t.not(await res1.text(), await res2.text());
});

test("DurableObjectsPlugin: reload: throws if object constructor cannot be found in exports", (t) => {
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
  });
  t.throws(() => plugin.reload({}, {}, new Map()), {
    instanceOf: DurableObjectError,
    code: "ERR_CLASS_NOT_FOUND",
    message: 'Class "TestObject" for Durable Object "TEST" not found',
  });
});
test("DurableObjectPlugin: reload: throws if script cannot be found in mounts", (t) => {
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: { className: "TestObject", scriptName: "test" } },
  });
  t.throws(() => plugin.reload({}, {}, new Map()), {
    instanceOf: DurableObjectError,
    code: "ERR_SCRIPT_NOT_FOUND",
    message:
      'Script "test" for Durable Object "TEST" not found.\n' +
      'Make sure "test" is mounted so Miniflare knows where to find it.',
  });
});
test("DurableObjectsPlugin: reload: throws if object constructor cannot be found in mount exports", (t) => {
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: { className: "TestObject", scriptName: "test" } },
  });
  const mounts = new Map<string, Mount>([
    ["test", { moduleExports: {}, usageModel: "bundled" }],
  ]);
  t.throws(() => plugin.reload({}, {}, mounts), {
    instanceOf: DurableObjectError,
    code: "ERR_CLASS_NOT_FOUND",
    message:
      'Class "TestObject" in script "test" for Durable Object "TEST" not found',
  });
});

test("DurableObjectsPlugin: setup alarms and dispose alarms", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
    durableObjectsAlarms: false,
  });
  await plugin.setup(factory);
  await plugin.dispose();
  t.false(plugin.durableObjectsAlarms);
});

test("DurableObjectsPlugin: set alarm and run list filters out alarm", async (t) => {
  class Object1 implements DurableObject {
    constructor(private readonly state: DurableObjectState) {}

    fetch = async () => {
      await this.state.storage.setAlarm(Date.now() + 60 * 1000);
      const list = await this.state.storage.list();
      return new Response(JSON.stringify(list));
    };
    alarm = () => {};
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { OBJECT1: "Object1" },
  });

  const result = await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { Object1 }, new Map());

  const ns1: DurableObjectNamespace = result.bindings?.OBJECT1;
  const res1 = await ns1.get(ns1.newUniqueId()).fetch("/");
  t.is(await res1.text(), "{}");
});

test("DurableObjectsPlugin: flush scheduled alarms", async (t) => {
  class TestObject implements DurableObject {
    constructor(private readonly state: DurableObjectState) {}

    async fetch() {
      await this.state.storage.setAlarm(Date.now() + 60 * 1000);
      return new Response("ok");
    }

    async alarm() {
      await this.state.storage.put("a", 1);
    }
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
    durableObjectsAlarms: true,
  });
  await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());

  // Construct the object
  const state = await plugin.getObject(factory, testId);
  const storage = state.storage;
  t.is(await storage.get("a"), undefined);

  // Check that flushing with no scheduled alarms does nothing
  await plugin.flushAlarms(factory);
  t.is(await storage.get("a"), undefined);

  // Schedule alarm
  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("/");
  t.is(await res.text(), "ok");

  // Check that scheduled alarm flushed
  await plugin.flushAlarms(factory);
  t.is(await storage.get("a"), 1);

  await plugin.dispose();
});
test("DurableObjectsPlugin: flush specific scheduled alarms", async (t) => {
  class TestObject implements DurableObject {
    constructor(private readonly state: DurableObjectState) {}

    async fetch() {
      await this.state.storage.setAlarm(Date.now() + 60 * 1000);
      return new Response("ok");
    }

    async alarm() {
      await this.state.storage.put("key", 1);
    }
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
    durableObjectsAlarms: true,
  });
  await plugin.setup(factory);
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());

  const ns = plugin.getNamespace(factory, "TEST");
  const idA = ns.idFromName("a");
  const idB = ns.idFromName("b");
  const idC = ns.idFromName("c");

  // Schedule alarms in `a` and `c`
  const resA = await ns.get(idA).fetch("/");
  t.is(await resA.text(), "ok");
  const resC = await ns.get(idC).fetch("/");
  t.is(await resC.text(), "ok");

  // Flush alarms for `a` and `b`, only `a`'s alarm should be executed, as `b`
  // hasn't been scheduled, and `c` isn't being flushed.
  await plugin.flushAlarms(factory, [idA, idB]);
  const storageA = plugin.getStorage(factory, idA);
  t.is(await storageA.get("key"), 1);
  const storageB = plugin.getStorage(factory, idB);
  t.is(await storageB.get("key"), undefined);
  const storageC = plugin.getStorage(factory, idC);
  t.is(await storageC.get("key"), undefined);

  await plugin.dispose();
});

test("DurableObjectsPlugin: immediately schedules persisted alarm", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/359

  // Create storage with alarm scheduled a second ago
  const alarmValue: StoredValueMeta = {
    value: new Uint8Array(),
    metadata: { scheduledTime: Date.now() - 1000 },
  };
  const alarmsMap = new Map<string, StoredValueMeta>();
  const objectMap = new Map<string, StoredValueMeta>();
  alarmsMap.set(`TEST:${testId.toString()}`, alarmValue);
  objectMap.set("__MINIFLARE_ALARMS__", alarmValue);
  const factory = new MemoryStorageFactory({
    [`test://map:__MINIFLARE_ALARMS__`]: alarmsMap,
    [`test://map:TEST:${testId.toString()}`]: objectMap,
  });

  // Check alarm scheduled in past executed immediately on plugin creation
  const [alarmTrigger, alarmPromise] = triggerPromise<void>();
  class TestObject {
    alarm() {
      alarmTrigger();
    }
  }
  const plugin = new DurableObjectsPlugin(ctx(), {
    durableObjects: { TEST: "TestObject" },
    durableObjectsPersist: "test://map",
  });
  await plugin.setup(factory);
  // Wait enough time for alarm to be executed (alarm shouldn't actually be
  // executed until `beforeReload()` is called)
  await setTimeout(500);
  await plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  await alarmPromise;

  t.pass();
});
