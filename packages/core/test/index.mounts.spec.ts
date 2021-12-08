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
  MiniflareCoreError,
  ReloadEvent,
} from "@miniflare/core";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import { HTTPPlugin, createServer } from "@miniflare/http-server";
import { KVPlugin } from "@miniflare/kv";
import { VMScriptRunner } from "@miniflare/runner-vm";
import { LogLevel, NoOpLog, StoredValueMeta } from "@miniflare/shared";
import {
  MemoryStorageFactory,
  TestLog,
  TestPlugin,
  useMiniflare,
  useTmp,
  waitForReload,
} from "@miniflare/shared-test";
import test from "ava";

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
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    scriptPath,
    "export default { fetch: (request, env) => new Response(`mounted:${env.KEY}`) }"
  );
  await fs.writeFile(packagePath, '{ "module": "worker.js" }');
  await fs.writeFile(envPath, "KEY=value");
  await fs.writeFile(
    wranglerConfigPath,
    `
[build.upload]
format = "modules"

[miniflare]
route = "localhost/tmp*"
`
  );

  const mf = useMiniflare({ BindingsPlugin }, { watch: true, mounts: { tmp } });
  let res = await mf.dispatchFetch("http://localhost/tmp");
  t.is(await res.text(), "mounted:value");

  // Check mounted worker files watched
  const reloadPromise = waitForReload(mf);
  await fs.writeFile(envPath, "KEY=value2");
  await reloadPromise;
  res = await mf.dispatchFetch("http://localhost/tmp");
  t.is(await res.text(), "mounted:value2");
});
test("MiniflareCore: #init: mounts share storage persistence options", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "worker.js");
  const packagePath = path.join(tmp, "package.json");
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
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
route = "localhost/tmp*"
`
  );

  const kvMap = new Map<string, StoredValueMeta>();
  const cacheMap = new Map<string, StoredValueMeta>();
  const durableObjectsMap = new Map<string, StoredValueMeta>();
  const storageFactory = new MemoryStorageFactory({
    "test://kv-persist:TEST_NAMESPACE": kvMap,
    "test://cache-persist:default": cacheMap,
    "test://durable-objects-persist:TEST_OBJECT:8f9973e23d7d465bb827b1ded10ae3e3d1e9b25f9e0763ab8ced46632d58ff07":
      durableObjectsMap,
  });
  let mf = useMiniflare(
    { KVPlugin, CachePlugin, DurableObjectsPlugin },
    {
      kvPersist: "test://kv-persist",
      cachePersist: "test://cache-persist",
      durableObjectsPersist: "test://durable-objects-persist",
      mounts: { tmp },
    },
    new NoOpLog(),
    storageFactory
  );
  await mf.dispatchFetch("http://localhost/tmp");

  // Check data stored in persist maps
  t.is(kvMap.size, 1);
  t.is(cacheMap.size, 1);
  t.is(durableObjectsMap.size, 1);

  // Check storage persistence options also shared with object-optioned mounts
  kvMap.clear();
  cacheMap.clear();
  durableObjectsMap.clear();

  mf = useMiniflare(
    { KVPlugin, CachePlugin, DurableObjectsPlugin },
    {
      kvPersist: "test://kv-persist",
      cachePersist: "test://cache-persist",
      durableObjectsPersist: "test://durable-objects-persist",
      mounts: {
        tmp: {
          rootPath: tmp,
          wranglerConfigPath: true,
          packagePath: true,
        },
      },
    },
    new NoOpLog(),
    storageFactory
  );
  await mf.dispatchFetch("http://localhost/tmp");
  t.is(kvMap.size, 1);
  t.is(cacheMap.size, 1);
  t.is(durableObjectsMap.size, 1);
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
  const mf = useMiniflare(
    {},
    // @ts-expect-error type definitions shouldn't allow this
    { mounts: { test: { mounts: { recursive: {} } } } }
  );
  await t.throwsAsync(mf.getPlugins(), {
    instanceOf: MiniflareCoreError,
    code: "ERR_MOUNT_NESTED",
    message: "Nested mounts are unsupported",
  });
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
  const mf = useMiniflare(
    {},
    {
      script: constantBodyScript("parent"),
      mounts: {
        a: { script: constantBodyScript("a"), routes: ["localhost/a*"] },
        b: { script: constantBodyScript("b"), routes: ["localhost/b*"] },
      },
    }
  );

  let res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "a");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "b");

  await mf.setOptions({
    mounts: { b: { script: constantBodyScript("b") } },
  });

  res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "parent");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "b");
});

test("MiniflareCore: #reload: includes mounted module exports when calling plugin reload hooks", async (t) => {
  const mf = useMiniflare(
    { TestPlugin },
    { mounts: { test: { modules: true, script: "export const thing = 42;" } } }
  );
  const plugins = await mf.getPlugins();
  t.is(plugins.TestPlugin.reloadMountedModuleExports?.test.thing, 42);
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
    [LogLevel.INFO, "Worker reloaded!"],
  ]);

  log.logs = [];
  await mf.dispose();
  t.deepEqual(log.logs, [[LogLevel.DEBUG, 'Unmounting "test"...']]);
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
  t.is(body, "https://example.com/a:example.com");
});

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
