import { setImmediate } from "timers/promises";
import { Response } from "@miniflare/core";
import {
  DurableObject,
  DurableObjectError,
  DurableObjectNamespace,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  StoredValue,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
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
    "OBJECT2=Object2",
    "--do-persist",
    "path",
  ]);
  t.deepEqual(options, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: "Object2" },
    durableObjectsPersist: "path",
  });
  options = parsePluginArgv(DurableObjectsPlugin, [
    "-o",
    "OBJECT1=Object1",
    "-o",
    "OBJECT2=Object2",
    "--do-persist",
  ]);
  t.deepEqual(options, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: "Object2" },
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
    miniflare: { durable_objects_persist: "path" },
  });
  t.deepEqual(options, {
    durableObjects: {
      OBJECT1: { className: "Object1", scriptName: undefined },
      OBJECT2: { className: "Object2", scriptName: "other_script" },
    },
    durableObjectsPersist: "path",
  });
});
test("DurableObjectsPlugin: logs options", (t) => {
  const logs = logPluginOptions(DurableObjectsPlugin, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: "Object2" },
    durableObjectsPersist: true,
  });
  t.deepEqual(logs, [
    "Durable Objects: OBJECT1, OBJECT2",
    "Durable Objects Persistence: true",
  ]);
});

test("DurableObjectsPlugin: for now, constructor throws if scriptName option used", (t) => {
  t.throws(
    () => {
      new DurableObjectsPlugin(ctx, {
        durableObjects: {
          OBJECT: { className: "Object", scriptName: "other_script" },
        },
      });
    },
    {
      instanceOf: Error,
      message: "Durable Object scriptName is not yet supported",
    }
  );
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
  plugin.reload({ TestObject }, {});
  await promise;
  t.is(factory.storages.size, 1);
});
test("DurableObjectsPlugin: getObject: object storage is namespaced by object name", async (t) => {
  const map = new Map<string, StoredValue>();
  const factory = new MemoryStorageFactory({
    [`map:TEST:${testId.toString()}`]: map,
  });
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
    durableObjectsPersist: "map",
  });
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});
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
  plugin.reload({ TestObject }, {});
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
  plugin.reload({ TestObject }, { KEY: "value" });
  const ns = plugin.getNamespace(factory, "TEST");
  const res = await ns.get(testId).fetch("http://localhost/");
  t.is(await res.text(), `${testId.toString()}:request1:GET:http://localhost/`);
  const state = await plugin.getObject(factory, testId);
  t.is(await state.storage.get("id"), testId.toString());
  t.deepEqual(await state.storage.get("env"), { KEY: "value" });
});
test("DurableObjectsPlugin: getNamespace: reuses single instance of object", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({ TestObject }, { KEY: "value" });
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
  }
  class Object2 implements DurableObject {
    fetch = () => new Response("object2");
  }

  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { OBJECT1: "Object1", OBJECT2: { className: "Object2" } },
  });

  const result = plugin.setup(factory);
  plugin.beforeReload();
  plugin.reload({ Object1, Object2 }, {});

  const ns1: DurableObjectNamespace = result.bindings?.OBJECT1;
  const ns2: DurableObjectNamespace = result.bindings?.OBJECT2;
  const res1 = await ns1.get(ns1.newUniqueId()).fetch("/");
  const res2 = await ns2.get(ns2.newUniqueId()).fetch("/");
  t.is(await res1.text(), "object1");
  t.is(await res2.text(), "object2");
});

test("DurableObjectsPlugin: beforeReload: deletes all instances", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});
  let ns = plugin.getNamespace(factory, "TEST");
  const res1 = await ns.get(testId).fetch("http://localhost:8787/instance");

  plugin.beforeReload();
  plugin.reload({ TestObject }, {});
  ns = plugin.getNamespace(factory, "TEST");
  const res2 = await ns.get(testId).fetch("http://localhost:8787/instance");

  // Check new instance created
  t.not(await res1.text(), await res2.text());
});

test("DurableObjectsPlugin: reload: throws if object constructor cannot be found in exports", (t) => {
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  t.throws(() => plugin.reload({}, {}), {
    instanceOf: DurableObjectError,
    code: "ERR_CLASS_NOT_FOUND",
    message: "Class TestObject for Durable Object TEST not found",
  });
});

test("DurableObjectsPlugin: dispose: deletes all instances", async (t) => {
  const factory = new MemoryStorageFactory();
  const plugin = new DurableObjectsPlugin(ctx, {
    durableObjects: { TEST: "TestObject" },
  });
  plugin.beforeReload();
  plugin.reload({ TestObject }, {});
  let ns = plugin.getNamespace(factory, "TEST");
  const res1 = await ns.get(testId).fetch("http://localhost:8787/instance");

  plugin.dispose();
  plugin.reload({ TestObject }, {});
  ns = plugin.getNamespace(factory, "TEST");
  const res2 = await ns.get(testId).fetch("http://localhost:8787/instance");

  // Check new instance created
  t.not(await res1.text(), await res2.text());
});
