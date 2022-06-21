import path from "path";
import { setImmediate } from "timers/promises";
import { Response } from "@miniflare/core";
import {
  DurableObject,
  DurableObjectError,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import {
  Compatibility,
  Mount,
  NoOpLog,
  PluginContext,
  StoredValue,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";
import { TestObject, testId } from "./object";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const ctx: PluginContext = { log, compat, rootPath };

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

test("DurableObjectsPlugin: getObject: waits for constructors and bindings", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
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
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
    durableObjectsPersist: "test://map",
  });
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const state = await plugin.getObject(factory, testId);
  await state.storage.put("key", "value");
  t.true(map.has("key"));
});
test("DurableObjectsPlugin: getObject: reresolves persist path relative to rootPath", async (t) => {
  const tmp = await useTmp(t);
  const map = new Map<string, StoredValue>();
  const factory = new MemoryStorageFactory({
    [`${tmp}${path.sep}test:TEST:${testId.toString()}`]: map,
  });
  const plugin = new DurableObjectsPlugin(
    { log, compat, rootPath: tmp },
    {
      durableObjects: { TEST: "TestObject" },
      durableObjectsPersist: "test",
    }
  );
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const state = await plugin.getObject(factory, testId);
  await state.storage.put("key", "value");
  t.true(map.has("key"));
});
test("DurableObjectsPlugin: getObject: reuses single instance of object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  const [object1, object2] = await Promise.all([
    plugin.getObject(factory, testId),
    plugin.getObject(factory, testId),
  ]);
  t.is(object1, object2);
});

test("DurableObjectsPlugin: getNamespace: creates namespace for object, creating instances with correct ID and environment", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
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
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: { className: "TestObject", scriptName: "test" } },
  });
  plugin.beforeReload();
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
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
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
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: { className: "Object2" } },
  });

  const result = await plugin.setup(factory);
  plugin.beforeReload();
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
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST_OBJECT: "TestObject" },
  });

  const result = await plugin.setup(factory);
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());

  const ns: DurableObjectNamespace = result.bindings?.TEST_OBJECT;
  const id = ns.idFromName("name");
  t.is(id.name, "name");
  const stub = ns.get(id);
  t.is(stub.id.name, "name");
  const res = await stub.fetch("/");
  t.is(await res.text(), "undefined");
});

test("DurableObjectsPlugin: beforeReload: deletes all instances", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  let ns = plugin.getNamespace(factory, "TEST");
  const res1 = await ns.get(testId).fetch("http://localhost:8787/instance");

  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  ns = plugin.getNamespace(factory, "TEST");
  const res2 = await ns.get(testId).fetch("http://localhost:8787/instance");

  // Check new instance created
  t.not(await res1.text(), await res2.text());
});

test("DurableObjectsPlugin: reload: throws if object constructor cannot be found in exports", (t) => {
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  t.throws(() => plugin.reload({}, {}, new Map()), {
    instanceOf: DurableObjectError,
    code: "ERR_CLASS_NOT_FOUND",
    message: 'Class "TestObject" for Durable Object "TEST" not found',
  });
});
test("DurableObjectPlugin: reload: throws if script cannot be found in mounts", (t) => {
  const plugin = new DurableObjectsPlugin(ctx, {
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
  const plugin = new DurableObjectsPlugin(ctx, {
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

test("DurableObjectsPlugin: dispose: deletes all instances", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({}, { TestObject }, new Map());
  let ns = plugin.getNamespace(factory, "TEST");
  const res1 = await ns.get(testId).fetch("http://localhost:8787/instance");

  plugin.dispose();
  plugin.reload({}, { TestObject }, new Map());
  ns = plugin.getNamespace(factory, "TEST");
  const res2 = await ns.get(testId).fetch("http://localhost:8787/instance");

  // Check new instance created
  t.not(await res1.text(), await res2.text());
});

test("DurableObjectsPlugin: setup alarms and dispose alarms", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
    durableObjectsAlarms: false,
  });
  await plugin.setup(factory);
  plugin.dispose();
  t.false(plugin.durableObjectsAlarms);
});
