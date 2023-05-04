import fs from "fs/promises";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { text } from "stream/consumers";
import { setTimeout } from "timers/promises";
import { CachePlugin } from "@miniflare/cache";
import {
  BindingsPlugin,
  CorePlugin,
  MiniflareCore,
  MiniflareCoreContext,
  MiniflareCoreError,
  MiniflareCoreOptions,
  ReloadEvent,
} from "@miniflare/core";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import { HTTPPlugin, createServer } from "@miniflare/http-server";
import { KVPlugin } from "@miniflare/kv";
import {
  MessageBatch,
  QueueBroker,
  QueueError,
  QueuesPlugin,
} from "@miniflare/queues";
import { VMScriptRunner } from "@miniflare/runner-vm";
import { LogLevel, NoOpLog, StoredValueMeta } from "@miniflare/shared";
import {
  AsyncTestLog,
  MemoryStorageFactory,
  TestLog,
  TestPlugin,
  triggerPromise,
  useMiniflare,
  useTmp,
  waitForReload,
} from "@miniflare/shared-test";
import test, { Macro, ThrowsExpectation } from "ava";
import { MiniflareOptions } from "miniflare";

// Specific tests for `mounts` option

const constantBodyScript = (body: string) =>
  `addEventListener("fetch", (e) => e.respondWith(new Response("${body}")))`;

test("MiniflareCore: #init: throws if mount has empty name", async (t) => {
  const mf = useMiniflare({}, { mounts: { "": {} } });
  await t.throwsAsync(mf.getPlugins(), {
    instanceOf: MiniflareCoreError,
    code: "ERR_MOUNT_NO_NAME",
    message: "Mount name cannot be empty",
  });
});
test("MiniflareCore: #init: mounts string-optioned mounts", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "worker.js");
  const packagePath = path.join(tmp, "package.json");
  const envPath = path.join(tmp, ".env");
  const envPathAlt = path.join(tmp, ".env.alt");
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    scriptPath,
    "export default { fetch: (request, env) => new Response(`mounted:${env.KEY}`) }"
  );
  await fs.writeFile(packagePath, '{ "module": "worker.js" }');
  await fs.writeFile(envPath, "KEY=value");
  await fs.writeFile(envPathAlt, "KEY=value-alt");
  const wranglerConfig = `
[build.upload]
format = "modules"

[miniflare]
route = "localhost/tmp*"
`;
  await fs.writeFile(wranglerConfigPath, wranglerConfig);

  const mf = useMiniflare({ BindingsPlugin }, { watch: true, mounts: { tmp } });
  let res = await mf.dispatchFetch("http://localhost/tmp");
  t.is(await res.text(), "mounted:value");

  // Check mounted worker files watched
  let reloadPromise = waitForReload(mf);
  await fs.writeFile(envPath, "KEY=value2");
  await reloadPromise;
  res = await mf.dispatchFetch("http://localhost/tmp");
  t.is(await res.text(), "mounted:value2");

  // Check env_path in wrangler.toml respected
  reloadPromise = waitForReload(mf);
  await fs.writeFile(
    wranglerConfigPath,
    wranglerConfig + 'env_path = ".env.alt"'
  );
  await reloadPromise;
  res = await mf.dispatchFetch("http://localhost/tmp");
  t.is(await res.text(), "mounted:value-alt");
});
test("MiniflareCore: #init: mounts object-optioned mounts", async (t) => {
  const mf = useMiniflare(
    {},
    {
      script:
        'addEventListener("fetch", (e) => e.respondWith(new Response("parent")))',
      mounts: {
        test: {
          modules: true,
          script: 'export default { fetch: () => new Response("mounted") }',
          routes: ["localhost/test*"],
        },
      },
    }
  );
  let res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/test");
  t.is(await res.text(), "mounted");
});
test("MiniflareCore: #init: throws when attempting to mount recursively", async (t) => {
  const expectations: ThrowsExpectation = {
    instanceOf: MiniflareCoreError,
    code: "ERR_MOUNT_NESTED",
    message: "Nested mounts are unsupported",
  };

  let mf = useMiniflare(
    {},
    // @ts-expect-error type definitions shouldn't allow this
    { mounts: { test: { mounts: { recursive: {} } } } }
  );
  await t.throwsAsync(mf.getPlugins(), expectations);

  // Check nested mounts still disallowed via setOptions on mount
  mf = useMiniflare({}, { mounts: { test: {} } });
  const mount = await mf.getMount("test");
  await t.throwsAsync(
    mount.setOptions({ mounts: { recursive: {} } }),
    expectations
  );
});
test("MiniflareCore: #init: updates existing mount options", async (t) => {
  const mf = useMiniflare(
    {},
    {
      script: constantBodyScript("parent"),
      mounts: {
        a: { script: constantBodyScript("a1"), routes: ["localhost/a*"] },
      },
    }
  );

  let res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "a1");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "parent");

  await mf.setOptions({
    mounts: {
      a: { script: constantBodyScript("a2"), routes: ["localhost/new-a*"] },
      b: { script: constantBodyScript("b"), routes: ["localhost/b*"] },
    },
  });

  res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/new-a");
  t.is(await res.text(), "a2");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "b");
});
test("MiniflareCore: #init: reloads parent on all but initial mount reloads", async (t) => {
  const events: ReloadEvent<any>[] = [];
  const mf = useMiniflare(
    {},
    {
      script: constantBodyScript("parent"),
      mounts: {
        test: {
          script: constantBodyScript("1"),
          routes: ["localhost/1*"],
        },
      },
    }
  );
  mf.addEventListener("reload", (e) => events.push(e));
  await mf.getPlugins();
  t.is(events.length, 1);
  let res = await mf.dispatchFetch("http://localhost/1");
  t.is(await res.text(), "1");

  const mount = await mf.getMount("test");
  await mount.setOptions({
    script: constantBodyScript("2"),
    routes: ["localhost/2*"],
  });
  await setTimeout(); // Wait for microtasks to finish
  t.is(events.length, 2);

  // Check routes reloaded too (even though we haven't called setOptions on parent)
  res = await mf.dispatchFetch("http://localhost/1");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/2");
  t.is(await res.text(), "2");
});
test("MiniflareCore: #init: wraps error with mount name if mount setup throws", async (t) => {
  const mf = useMiniflare({}, { mounts: { test: { script: "(" } } });
  let error: MiniflareCoreError | undefined;
  try {
    await mf.getPlugins();
  } catch (e: any) {
    error = e;
  }
  t.is(error?.code, "ERR_MOUNT");
  t.is(error?.message, 'Error mounting "test"');
  t.is(error?.cause?.name, "SyntaxError");
});
test("MiniflareCore: #init: disposes removed mounts", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare(
    {},
    {
      script: constantBodyScript("parent"),
      mounts: {
        a: { script: constantBodyScript("a"), routes: ["localhost/a*"] },
        b: { script: constantBodyScript("b"), routes: ["localhost/b*"] },
      },
    },
    log
  );
  let res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "a");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "b");

  log.logs = [];
  await mf.setOptions({
    mounts: { b: { script: constantBodyScript("b") } },
  });
  t.true(log.logsAtLevel(LogLevel.DEBUG).includes('Unmounting "a"...'));
  res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "b");

  // Try removing mounts option completely
  log.logs = [];
  await mf.setOptions({ mounts: undefined });
  t.true(log.logsAtLevel(LogLevel.DEBUG).includes('Unmounting "b"...'));
  res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "parent");
});
test("MiniflareCore: #init: doesn't throw if script required, parent script not provided, but has mounts", async (t) => {
  const ctx: MiniflareCoreContext = {
    log: new NoOpLog(),
    storageFactory: new MemoryStorageFactory(),
    scriptRunner: new VMScriptRunner(),
    scriptRequired: true,
    queueBroker: new QueueBroker(),
  };

  const mf = new MiniflareCore({ CorePlugin }, ctx, {
    mounts: { a: { script: constantBodyScript("a") } },
  });
  await mf.getPlugins();
  t.pass();
});
test("MiniflareCore: #init: logs reload errors when mount options update instead of unhandled rejection", async (t) => {
  const log = new AsyncTestLog();
  const ctx: MiniflareCoreContext = {
    log,
    storageFactory: new MemoryStorageFactory(),
    scriptRunner: new VMScriptRunner(),
    queueBroker: new QueueBroker(),
  };
  const mf = new MiniflareCore({ CorePlugin, DurableObjectsPlugin }, ctx, {
    mounts: { a: { script: "//" } },
  });
  await mf.getPlugins();
  // Simulate file change in mount that would throw
  const mount = await mf.getMount("a");
  await mount.setOptions({
    durableObjects: { TEST_OBJECT: "IDontExist" },
  });
  t.regex((await log.nextAtLevel(LogLevel.ERROR)) ?? "", /ERR_CLASS_NOT_FOUND/);
});

test("MiniflareCore: #updateRouter: requires mounted name and service name to match", async (t) => {
  const mf = useMiniflare({}, { mounts: { a: { name: "b", script: "//" } } });
  await t.throwsAsync(mf.getPlugins(), {
    instanceOf: MiniflareCoreError,
    code: "ERR_MOUNT_NAME_MISMATCH",
    message: 'Mounted name "a" must match service name "b"',
  });
});

test("MiniflareCore: #reload: includes mounts when calling plugin reload hooks", async (t) => {
  const mf = useMiniflare(
    { TestPlugin },
    { mounts: { test: { modules: true, script: "export const thing = 42;" } } }
  );
  const plugins = await mf.getPlugins();
  t.is(plugins.TestPlugin.reloadMounts?.get("test")?.moduleExports?.thing, 42);
});
test("MiniflareCore: #reload: runs all reload hooks after all workers reloaded", async (t) => {
  // This is required to allow mounts to access parent exports, or other mounts,
  // potentially in a cycle (e.g. service bindings)

  const constantExportScript = (x: string) =>
    `export const x = ${JSON.stringify(x)};`;
  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin },
    {
      name: "parent",
      modules: true,
      script: constantExportScript("parent"),
      hookLogIdentifier: "parent:",
      mounts: {
        a: {
          name: "a",
          modules: true,
          script: constantExportScript("a"),
          hookLogIdentifier: "a:",
        },
        b: {
          name: "b",
          modules: true,
          script: constantExportScript("b"),
          hookLogIdentifier: "b:",
        },
      },
    },
    log
  );
  // Check on initial load
  await mf.getPlugins();
  t.deepEqual(log.logsAtLevel(LogLevel.INFO), [
    "parent:beforeSetup",
    "parent:setup",
    "a:beforeSetup",
    "a:setup",
    "a:beforeReload", // a beforeReload called, but not reload
    "Worker reloaded! (21B)", // a reload complete
    "b:beforeSetup",
    "b:setup",
    "b:beforeReload", // b beforeReload called, but not reload
    "Worker reloaded! (21B)", // b reload complete
    // All beforeReloads called...
    "parent:beforeReload",
    "a:beforeReload",
    "b:beforeReload",
    // ...followed by all reloads
    "parent:reload",
    "a:reload",
    "b:reload",
    "Worker reloaded! (26B)", // parent reload complete
  ]);

  // Check all exports included in mounts reload hooks called with
  let mounts = (await mf.getPlugins()).TestPlugin.reloadMounts;
  t.is(mounts?.get("parent")?.moduleExports?.x, "parent");
  t.is(mounts?.get("a")?.moduleExports?.x, "a");
  t.is(mounts?.get("b")?.moduleExports?.x, "b");
  const a = await mf.getMount("a");
  const b = await mf.getMount("b");
  t.is((await a.getPlugins()).TestPlugin.reloadMounts, mounts);
  t.is((await b.getPlugins()).TestPlugin.reloadMounts, mounts);

  // Check when updating mount
  log.logs = [];
  await a.setOptions({ script: constantExportScript("a:updated") });
  await waitForReload(mf);
  t.deepEqual(log.logsAtLevel(LogLevel.INFO), [
    "a:beforeReload", // a beforeReload called, but not reload
    "Worker reloaded! (29B)", // a reload complete
    // All beforeReloads called...
    "parent:beforeReload",
    "a:beforeReload",
    "b:beforeReload",
    // ...followed by all reloads
    "parent:reload",
    "a:reload",
    "b:reload",
    "Worker reloaded! (26B)", // parent reload complete
  ]);

  // Check all exports included in mounts reload hooks called with again
  mounts = (await mf.getPlugins()).TestPlugin.reloadMounts;
  t.is(mounts?.get("parent")?.moduleExports?.x, "parent");
  t.is(mounts?.get("a")?.moduleExports?.x, "a:updated");
  t.is(mounts?.get("b")?.moduleExports?.x, "b");
  t.is((await a.getPlugins()).TestPlugin.reloadMounts, mounts);
  t.is((await b.getPlugins()).TestPlugin.reloadMounts, mounts);
});

test("MiniflareCore: getMount: gets mounted worker instance", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    { mounts: { test: { globals: { KEY: "value" } } } }
  );
  const mount = await mf.getMount("test");
  const globalScope = await mount.getGlobalScope();
  t.is(globalScope.KEY, "value");
});

test("MiniflareCore: dispose: disposes of mounts too", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare({}, { mounts: { test: { script: "//" } } }, log);
  await mf.getPlugins();
  t.deepEqual(log.logs, [
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "- Mounts: test"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [
      LogLevel.WARN,
      "Mounts are experimental. There may be breaking changes in the future.",
    ],
    [LogLevel.VERBOSE, "- setup(CorePlugin)"],
    [LogLevel.DEBUG, 'Mounting "test"...'],
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [LogLevel.VERBOSE, "- setup(CorePlugin)"],
    [LogLevel.DEBUG, "Reloading worker..."],
    [LogLevel.VERBOSE, "Running script..."],
    [LogLevel.INFO, "Worker reloaded! (2B)"],
    [LogLevel.DEBUG, "Mount Routes: <none>"],
    [LogLevel.DEBUG, "Reloading worker..."],
  ]);

  log.logs = [];
  await mf.dispose();
  t.deepEqual(log.logs, [[LogLevel.DEBUG, 'Unmounting "test"...']]);
});

test("MiniflareCore: includes named parent worker when matching mount routes", async (t) => {
  const mf = useMiniflare(
    {},
    {
      name: "parent",
      routes: ["localhost/api"],
      script: constantBodyScript("parent"),
      mounts: {
        a: {
          name: "a",
          routes: ["*localhost/api*"], // less specific than parent route
          script: constantBodyScript("a"),
        },
      },
    }
  );

  // Check parent worker checked first
  let res = await mf.dispatchFetch("http://localhost/api");
  t.is(await res.text(), "parent");

  // Check mounted worker still accessible
  res = await mf.dispatchFetch("http://localhost/api2");
  t.is(await res.text(), "a");

  // Check fallback to parent worker
  res = await mf.dispatchFetch("http://localhost/notapi");
  t.is(await res.text(), "parent");
});
test("MiniflareCore: uses original protocol and host when matching mount routes", async (t) => {
  const mf = useMiniflare(
    { HTTPPlugin },
    {
      script: constantBodyScript("parent"),
      upstream: "https://miniflare.dev",
      mounts: {
        a: {
          modules: true,
          // Should use this upstream instead of parent
          upstream: "https://example.com",
          script: `export default {
            async fetch(request) {
              return new Response(\`\${request.url}:\${request.headers.get("host")}\`);
            }
          }`,
          // Should match against this host, not the upstream's
          routes: ["http://custom.mf/*"],
        },
      },
    }
  );
  const server = await createServer(mf);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
  const body = await new Promise<string>((resolve) => {
    http.get(
      { host: "localhost", port, path: "/a", headers: { host: "custom.mf" } },
      async (res) => resolve(await text(res))
    );
  });
  t.is(body, "https://example.com/a:custom.mf");
});

test("MiniflareCore: dispatches scheduled event to mount", async (t) => {
  const mf = useMiniflare(
    {},
    {
      modules: true,
      script: `export default {
        scheduled(controller, env, ctx) {
          ctx.waitUntil("parent");
          ctx.waitUntil(controller.scheduledTime);
          ctx.waitUntil(controller.cron);
        }
      }`,
      mounts: {
        a: {
          routes: ["https://test.mf/*"],
          script: `addEventListener("scheduled", (event) => {
            event.waitUntil("mount");
            event.waitUntil(event.scheduledTime);
            event.waitUntil(event.cron);
          })`,
        },
      },
    }
  );
  let waitUntil = await mf.dispatchScheduled(1000, "* * * * *");
  t.deepEqual(waitUntil, ["parent", 1000, "* * * * *"]);
  waitUntil = await mf.dispatchScheduled(
    1000,
    "* * * * *",
    "https://test.mf/cdn-cgi/mf/scheduled"
  );
  t.deepEqual(waitUntil, ["mount", 1000, "* * * * *"]);
});

test("MiniflareCore: consumes queue in mount", async (t) => {
  const opts: MiniflareCoreOptions<{
    CorePlugin: typeof CorePlugin;
    BindingsPlugin: typeof BindingsPlugin;
    QueuesPlugin: typeof QueuesPlugin;
  }> = {
    queueBindings: [{ name: "QUEUE", queueName: "queue" }],
    modules: true,
    script: `export default {
      async fetch(request, env, ctx) {
        env.QUEUE.send("message");
        return new Response();
      }
    }`,
    mounts: {
      a: {
        bindings: {
          REPORTER(batch: MessageBatch) {
            trigger(batch);
          },
        },
        queueConsumers: [{ queueName: "queue", maxWaitMs: 0 }],
        modules: true,
        script: `export default {
          queue(batch, env, ctx) {
            env.REPORTER(batch);
          }
        }`,
      },
    },
  };

  // Check consumes messages sent in different mount
  let [trigger, promise] = triggerPromise<MessageBatch>();
  const mf = useMiniflare({ BindingsPlugin, QueuesPlugin }, opts);
  await mf.dispatchFetch("http://localhost");
  let batch = await promise;
  t.is(batch.messages.length, 1);
  t.is(batch.messages[0].body, "message");
  // ...even after reload (https://github.com/cloudflare/miniflare/issues/560)
  await mf.reload();
  [trigger, promise] = triggerPromise<MessageBatch>();
  await mf.dispatchFetch("http://localhost");
  batch = await promise;
  t.is(batch.messages.length, 1);
  t.is(batch.messages[0].body, "message");

  // Check queue can have at most one consumer
  opts.queueConsumers = ["queue"]; // (adding parent as consumer too)
  await t.throwsAsync(mf.setOptions(opts), {
    instanceOf: QueueError,
    code: "ERR_CONSUMER_ALREADY_SET",
  });
});

// Shared storage persistence tests
type PersistOptions = Pick<
  MiniflareOptions,
  "kvPersist" | "cachePersist" | "durableObjectsPersist"
>;
const mountStorageMacro: Macro<
  [
    parentPersist: PersistOptions | undefined,
    childPersist: PersistOptions | undefined,
    resolvedPersistFunction: (
      tmp: string,
      mount: string
    ) => {
      kvPersist: string;
      cachePersist: string;
      durableObjectsPersist: string;
    }
  ]
> = async (t, parentPersist, childPersist, resolvedPersistFunction) => {
  const tmp = await useTmp(t);

  const mount = path.join(tmp, "mount");
  await fs.mkdir(mount);
  const scriptPath = path.join(mount, "worker.js");
  const packagePath = path.join(mount, "package.json");
  const wranglerConfigPath = path.join(mount, "wrangler.toml");
  await fs.writeFile(
    scriptPath,
    `
export class TestObject {
  constructor(state) {
    this.storage = state.storage;
  }
  async fetch() {
    await this.storage.put("key", "value");
    return new Response();
  }
}

export default {
  async fetch(request, env) {
    const { TEST_NAMESPACE, TEST_OBJECT } = env;
    
    await TEST_NAMESPACE.put("key", "value");
    
    await caches.default.put("http://localhost/", new Response("body", {
      headers: { "Cache-Control": "max-age=3600" }
    }));

    const id = TEST_OBJECT.idFromName("test");
    const stub = TEST_OBJECT.get(id);
    await stub.fetch("http://localhost/");
  
    return new Response();
  }
}`
  );

  await fs.writeFile(packagePath, '{ "module": "worker.js" }');

  let { kvPersist, cachePersist, durableObjectsPersist } = childPersist ?? {};
  kvPersist &&= JSON.stringify(kvPersist);
  cachePersist &&= JSON.stringify(cachePersist);
  durableObjectsPersist &&= JSON.stringify(durableObjectsPersist);
  await fs.writeFile(
    wranglerConfigPath,
    `
kv_namespaces = [
  { binding = "TEST_NAMESPACE" }
]
    
[durable_objects]
bindings = [
  { name = "TEST_OBJECT", class_name = "TestObject" },
]
    
[build.upload]
format = "modules"

[miniflare]
route = "localhost/mount*"
${kvPersist ? `kv_persist = ${kvPersist}` : ""}
${cachePersist ? `cache_persist = ${cachePersist}` : ""}
${
  durableObjectsPersist
    ? `durable_objects_persist = ${durableObjectsPersist}`
    : ""
}
`
  );

  const kvMap = new Map<string, StoredValueMeta>();
  const cacheMap = new Map<string, StoredValueMeta>();
  const durableObjectsMap = new Map<string, StoredValueMeta>();
  const resolvedPersist = resolvedPersistFunction(tmp, mount);
  const storageFactory = new MemoryStorageFactory({
    [`${resolvedPersist.kvPersist}:TEST_NAMESPACE`]: kvMap,
    [`${resolvedPersist.cachePersist}:default`]: cacheMap,
    [`${resolvedPersist.durableObjectsPersist}:TEST_OBJECT:8f9973e23d7d465bb827b1ded10ae3e3d1e9b25f9e0763ab8ced46632d58ff07`]:
      durableObjectsMap,
  });
  const mf = useMiniflare(
    { KVPlugin, CachePlugin, DurableObjectsPlugin },
    {
      rootPath: tmp,
      ...parentPersist,
      mounts: { mount },
    },
    new NoOpLog(),
    storageFactory
  );
  await mf.dispatchFetch("http://localhost/mount");

  // Check data stored in persist maps
  t.is(kvMap.size, 1);
  t.is(cacheMap.size, 1);
  t.is(durableObjectsMap.size, 1);
};
mountStorageMacro.title = (providedTitle) =>
  `MiniflareCore: #init: ${providedTitle}`;
// ...in parent
test(
  "resolves boolean persistence in parent relative to working directory",
  mountStorageMacro,
  {
    kvPersist: true,
    cachePersist: true,
    durableObjectsPersist: true,
  },
  undefined,
  () => ({
    kvPersist: path.join(".mf", "kv"),
    cachePersist: path.join(".mf", "cache"),
    durableObjectsPersist: path.join(".mf", "durableobjects"),
  })
);
test(
  "resolves string persistence in parent relative to parent's root",
  mountStorageMacro,
  {
    kvPersist: "kv",
    cachePersist: "cache",
    durableObjectsPersist: "durable-objects",
  },
  undefined,
  (tmp) => ({
    kvPersist: path.join(tmp, "kv"),
    cachePersist: path.join(tmp, "cache"),
    durableObjectsPersist: path.join(tmp, "durable-objects"),
  })
);
test(
  "uses url persistence in parent as is",
  mountStorageMacro,
  {
    kvPersist: "test://kv",
    cachePersist: "test://cache",
    durableObjectsPersist: "test://durable-objects",
  },
  undefined,
  () => ({
    kvPersist: "test://kv",
    cachePersist: "test://cache",
    durableObjectsPersist: "test://durable-objects",
  })
);
// ...in mount
test(
  "resolves boolean persistence in mount relative to working directory",
  mountStorageMacro,
  undefined,
  {
    kvPersist: true,
    cachePersist: true,
    durableObjectsPersist: true,
  },
  () => ({
    kvPersist: path.join(".mf", "kv"),
    cachePersist: path.join(".mf", "cache"),
    durableObjectsPersist: path.join(".mf", "durableobjects"),
  })
);
test(
  "resolves string persistence in mount relative to mount's root",
  mountStorageMacro,
  undefined,
  {
    kvPersist: "kv",
    cachePersist: "cache",
    durableObjectsPersist: "durable-objects",
  },
  (tmp, mount) => ({
    kvPersist: path.join(mount, "kv"),
    cachePersist: path.join(mount, "cache"),
    durableObjectsPersist: path.join(mount, "durable-objects"),
  })
);
test(
  "uses url persistence in mount as is",
  mountStorageMacro,
  undefined,
  {
    kvPersist: "test://kv",
    cachePersist: "test://cache",
    durableObjectsPersist: "test://durable-objects",
  },
  () => ({
    kvPersist: "test://kv",
    cachePersist: "test://cache",
    durableObjectsPersist: "test://durable-objects",
  })
);

// Durable Objects script_name integration tests
test("MiniflareCore: reloads Durable Object classes used by parent when mounted worker reloads", async (t) => {
  const durableObjectScript = (body: string) => `export class TestObject {
    fetch() {
      return new Response("${body}");
    }
  }`;
  const mf = useMiniflare(
    { DurableObjectsPlugin },
    {
      modules: true,
      script: `export default {
        async fetch(request, { TEST_OBJECT }) {
          const id = TEST_OBJECT.idFromName("a");
          const stub = TEST_OBJECT.get(id);
          return stub.fetch(request);
        }
      }`,
      durableObjects: {
        TEST_OBJECT: { className: "TestObject", scriptName: "test" },
      },
      mounts: { test: { modules: true, script: durableObjectScript("1") } },
    }
  );
  let res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "1");

  // Update Durable Object script and check constructors in parent updated too
  const reloadPromise = waitForReload(mf);
  const mount = await mf.getMount("test");
  await mount.setOptions({ script: durableObjectScript("2") });
  await reloadPromise;

  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "2");
});
test("MiniflareCore: runs mounted worker script for Durable Object classes used by parent if scriptRunForModuleExports set", async (t) => {
  const mf = new MiniflareCore(
    { CorePlugin, DurableObjectsPlugin },
    {
      log: new NoOpLog(),
      storageFactory: new MemoryStorageFactory(),
      scriptRunner: new VMScriptRunner(),
      scriptRunForModuleExports: true,
      queueBroker: new QueueBroker(),
    },
    {
      modules: true,
      script: `export default {
        async fetch(request, { TEST_OBJECT }) {
          const id = TEST_OBJECT.idFromName("a");
          const stub = TEST_OBJECT.get(id);
          return stub.fetch(request);
        }
      }`,
      durableObjects: {
        TEST_OBJECT: { className: "TestObject", scriptName: "test" },
      },
      mounts: {
        test: {
          modules: true,
          script: `export class TestObject {
            fetch() {
              return new Response("object");
            }
          }`,
        },
      },
    }
  );
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "object");
});
test("MiniflareCore: can access Durable Objects defined in parent or other mounts in mount", async (t) => {
  const doScript = (
    className: string,
    response: string
  ) => `export class ${className} {
          fetch() {
            return new Response("${response}");
          }
        }`;
  const mf = new MiniflareCore(
    { CorePlugin, DurableObjectsPlugin },
    {
      log: new NoOpLog(),
      storageFactory: new MemoryStorageFactory(),
      scriptRunner: new VMScriptRunner(),
      queueBroker: new QueueBroker(),
    },
    {
      name: "parent",
      modules: true,
      script: doScript("ParentObject", "parent object"),
      mounts: {
        a: {
          name: "a",
          modules: true,
          script: doScript("MountAObject", "mount a object"),
        },
        b: {
          name: "b",
          durableObjects: {
            PARENT_OBJECT: { className: "ParentObject", scriptName: "parent" },
            MOUNT_A_OBJECT: { className: "MountAObject", scriptName: "a" },
          },
          routes: ["*"],
          modules: true,
          script: `export default {
            async fetch(request, { PARENT_OBJECT, MOUNT_A_OBJECT }) {
              // Using named IDs to check object instances are reset
              const parentId = PARENT_OBJECT.idFromName("id");
              const aId = MOUNT_A_OBJECT.idFromName("id");
              
              const parentStub = PARENT_OBJECT.get(parentId);
              const aStub = MOUNT_A_OBJECT.get(aId);
              
              const parentRes = await parentStub.fetch("http://localhost/");
              const aRes = await aStub.fetch("http://localhost/");
              
              const parentText = await parentRes.text();
              const aText = await aRes.text();
              
              return new Response(parentText + ":" + aText);
            }
          }`,
        },
      },
    }
  );

  let res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "parent object:mount a object");

  // Check updates to mount A reflected in mount B
  const a = await mf.getMount("a");
  await a.setOptions({ script: doScript("MountAObject", "mount a object 2") });
  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "parent object:mount a object 2");

  // Check updates to parent reflected in mount B
  await mf.setOptions({ script: doScript("ParentObject", "parent object 2") });
  res = await mf.dispatchFetch("http://localhost/");
  // TODO (someday): this is a bug, should be "parent object 2:mount a object 2"
  //  but setOptions in a mount doesn't update parent's previous options object.
  //  setOptions in mounts shouldn't really be exposed to end-users, it's only
  //  meant for testing.
  t.is(await res.text(), "parent object 2:mount a object");
});
test("MiniflareCore: reuses same instances across mounts", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/461

  const script = (name: string) => `export class ${name}Object {
    uuid = crypto.randomUUID();
    fetch() {
      return new Response("from ${name}: " + this.uuid);
    }
  }
  export default {
    async fetch(request, env) {
      const name = new URL(request.url).pathname.substring(1);
      const OBJECT = env[name];
      const id = OBJECT.idFromName("fixed");
      const stub = OBJECT.get(id);
      const res = await stub.fetch(request);
      const text = await res.text();
      return new Response("via ${name}: " + text);
    }
  }`;

  const mf = useMiniflare(
    { DurableObjectsPlugin },
    {
      name: "parent",
      modules: true,
      script: script("Parent"),
      durableObjects: {
        PARENT_OBJECT: { className: "ParentObject" },
        MOUNT_OBJECT: { className: "MountObject", scriptName: "mount" },
      },
      mounts: {
        mount: {
          name: "mount",
          modules: true,
          script: script("Mount"),
          durableObjects: {
            PARENT_OBJECT: { className: "ParentObject", scriptName: "parent" },
            MOUNT_OBJECT: { className: "MountObject" },
          },
          routes: ["http://mount.mf/*"],
        },
      },
    }
  );

  const uuidRegexp =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const extractUuid = (text: string) =>
    text.substring(text.lastIndexOf(":") + 2);

  // First access objects from parent...
  let res = await mf.dispatchFetch("http://localhost/PARENT_OBJECT");
  let text = await res.text();
  const parentUuid = extractUuid(text);
  t.regex(parentUuid, uuidRegexp);
  t.is(text, `via Parent: from Parent: ${parentUuid}`);

  res = await mf.dispatchFetch("http://localhost/MOUNT_OBJECT");
  text = await res.text();
  const mountUuid = extractUuid(text);
  t.regex(mountUuid, uuidRegexp);
  t.not(mountUuid, parentUuid);
  t.is(text, `via Parent: from Mount: ${mountUuid}`);

  // ...then access those same objects from a different mount, checking the
  // same instances are used.
  res = await mf.dispatchFetch("http://mount.mf/PARENT_OBJECT");
  t.is(await res.text(), `via Mount: from Parent: ${parentUuid}`);

  res = await mf.dispatchFetch("http://mount.mf/MOUNT_OBJECT");
  t.is(await res.text(), `via Mount: from Mount: ${mountUuid}`);
});
