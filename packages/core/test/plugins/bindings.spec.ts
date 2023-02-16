import assert from "assert";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { setImmediate } from "timers/promises";
import { CachePlugin } from "@miniflare/cache";
import {
  BindingsPlugin,
  Fetcher,
  MiniflareCoreError,
  Response,
  _CoreMount,
} from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  getRequestContext,
  viewToBuffer,
} from "@miniflare/shared";
import { TestLog, unusable } from "@miniflare/shared-test";
import {
  getObjectProperties,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  useMiniflare,
  useServer,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: unusable(),
};

const fixturesPath = path.join(__dirname, "..", "..", "..", "test", "fixtures");
// add.wasm is a WebAssembly module with a single export "add" that adds
// its 2 integer parameters together and returns the result, it is from:
// https://webassembly.github.io/wabt/demo/wat2wasm/
const addModulePath = path.join(fixturesPath, "add.wasm");
// lorem-ipsum.txt is five paragraphs of lorem ipsum nonsense text
const loremIpsumPath = path.join(fixturesPath, "lorem-ipsum.txt");
const loremIpsum = readFileSync(loremIpsumPath, "utf-8");
// we also make a data version of it to verify aganst data blobs
const loremIpsumData = viewToBuffer(readFileSync(loremIpsumPath));

test("BindingsPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(BindingsPlugin, [
    "--env",
    ".env.test",
    "--binding",
    "KEY1=value1",
    "--binding",
    "KEY2=value2",
    "--global",
    "KEY3=value3",
    "--global",
    "KEY4=value4",
    "--wasm",
    "MODULE1=module1.wasm",
    "--wasm",
    "MODULE2=module2.wasm",
    "--text-blob",
    "TEXT1=text-blob-1.txt",
    "--text-blob",
    "TEXT2=text-blob-2.txt",
    "--data-blob",
    "DATA1=data-blob-1.bin",
    "--data-blob",
    "DATA2=data-blob-2.bin",
    "--service",
    "SERVICE1=service1",
    "--service",
    "SERVICE2=service2@development",
  ]);
  t.deepEqual(options, {
    envPath: ".env.test",
    bindings: { KEY1: "value1", KEY2: "value2" },
    globals: { KEY3: "value3", KEY4: "value4" },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
    textBlobBindings: { TEXT1: "text-blob-1.txt", TEXT2: "text-blob-2.txt" },
    dataBlobBindings: { DATA1: "data-blob-1.bin", DATA2: "data-blob-2.bin" },
    serviceBindings: {
      SERVICE1: "service1",
      SERVICE2: { service: "service2", environment: "development" },
    },
  });
  options = parsePluginArgv(BindingsPlugin, [
    "-e",
    ".env.test",
    "-b",
    "KEY1=value1",
    "-b",
    "KEY2=value2",
    "-S",
    "SERVICE1=service1",
    "-S",
    "SERVICE2=service2@development",
  ]);
  t.deepEqual(options, {
    envPath: ".env.test",
    bindings: { KEY1: "value1", KEY2: "value2" },
    serviceBindings: {
      SERVICE1: "service1",
      SERVICE2: { service: "service2", environment: "development" },
    },
  });
});
test("BindingsPlugin: parses options from wrangler config", async (t) => {
  let options = parsePluginWranglerConfig(BindingsPlugin, {
    wasm_modules: {
      MODULE1: "module1.wasm",
      MODULE2: "module2.wasm",
    },
    text_blobs: {
      TEXT1: "text-blob-1.txt",
      TEXT2: "text-blob-2.txt",
    },
    data_blobs: {
      DATA1: "data-blob-1.bin",
      DATA2: "data-blob-2.bin",
    },
    services: [
      { name: "SERVICE1", service: "service1", environment: "development" },
      { name: "SERVICE2", service: "service2", environment: "production" },
      { binding: "SERVICE_A", service: "service1", environment: "development" },
      { binding: "SERVICE_B", service: "service2", environment: "production" },
    ],
    experimental_services: [
      { name: "SERVICE3", service: "service3", environment: "staging" },
      { binding: "SERVICE_C", service: "service3", environment: "staging" },
    ],
    miniflare: {
      globals: { KEY5: "value5", KEY6: false, KEY7: 10 },
      env_path: ".env.test",
    },
  });
  t.like(options, {
    envPath: ".env.test",
    globals: { KEY5: "value5", KEY6: false, KEY7: 10 },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
    textBlobBindings: { TEXT1: "text-blob-1.txt", TEXT2: "text-blob-2.txt" },
    dataBlobBindings: { DATA1: "data-blob-1.bin", DATA2: "data-blob-2.bin" },
    serviceBindings: {
      SERVICE1: { service: "service1", environment: "development" },
      SERVICE2: { service: "service2", environment: "production" },
      SERVICE3: { service: "service3", environment: "staging" },
      SERVICE_A: { service: "service1", environment: "development" },
      SERVICE_B: { service: "service2", environment: "production" },
      SERVICE_C: { service: "service3", environment: "staging" },
    },
  });

  // Wrangler bindings are stored in the kWranglerBindings symbol, which isn't
  // exported, so setup the plugin and check they're included
  options = parsePluginWranglerConfig(BindingsPlugin, {
    vars: { KEY1: "value1", KEY2: "value2", KEY3: true, KEY4: 42 },
  });
  const plugin = new BindingsPlugin(ctx, options);
  const result = await plugin.setup();
  // Wrangler bindings should be stringified
  t.deepEqual(result.bindings, {
    KEY1: "value1",
    KEY2: "value2",
    KEY3: "true",
    KEY4: "42",
  });
});

test("BindingsPlugin: logs no warnings if `binding` used without `name`", async (t) => {
  const log = new TestLog();
  const service = "service123";

  parsePluginWranglerConfig(
    BindingsPlugin,
    {
      services: [
        { binding: "SERVICE123", service, environment: "development" },
      ],
    },
    "",
    log
  );

  // Check warning logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 0);
});
test("BindingsPlugin: logs warning if `name` is used instead of `binding`", async (t) => {
  const log = new TestLog();
  const service = "service123";

  parsePluginWranglerConfig(
    BindingsPlugin,
    {
      services: [{ name: "SERVICE123", service, environment: "development" }],
    },
    "",
    log
  );

  // Check warning logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 1);
  const [warning] = warnings;

  t.true(warning.includes(service));
  t.regex(
    warning,
    /^Service "\w+" declared using deprecated syntax\.\nThe `name` key should be removed and renamed to `binding`\.$/
  );
});
test("BindingsPlugin: logs warning if `name` and `binding` are both used but they are the same", async (t) => {
  const log = new TestLog();
  const service = "service123";
  const name = "SERVICE123";
  const binding = name;

  parsePluginWranglerConfig(
    BindingsPlugin,
    {
      services: [{ name, binding, service, environment: "development" }],
    },
    "",
    log
  );

  // Check no warnings logged
  const warnings = log.logsAtLevel(LogLevel.WARN);
  t.is(warnings.length, 1);
  const [warning] = warnings;

  t.true(warning.includes(service));
  t.regex(
    warning,
    /^Service "\w+" declared using deprecated syntax\.\nThe `name` key should be removed and renamed to `binding`\.$/
  );
});
test("BindingsPlugin: throws if `name` and `binding` are both present and don't match", (t) => {
  t.throws(
    () =>
      parsePluginWranglerConfig(BindingsPlugin, {
        services: [
          {
            name: "SERVICE1",
            binding: "SERVICE_A",
            service: "service1",
            environment: "development",
          },
        ],
      }),
    {
      instanceOf: MiniflareCoreError,
      code: "ERR_SERVICE_NAME_MISMATCH",
    }
  );
});
test("BindingsPlugin: throws if `name` and `binding` are both absent", (t) => {
  t.throws(
    () =>
      parsePluginWranglerConfig(BindingsPlugin, {
        services: [
          {
            service: "service1",
            environment: "development",
          },
        ],
      }),
    {
      instanceOf: MiniflareCoreError,
      code: "ERR_SERVICE_NO_NAME",
    }
  );
});

test("BindingsPlugin: logs options", (t) => {
  // wranglerOptions should contain [kWranglerBindings]
  const wranglerOptions = parsePluginWranglerConfig(BindingsPlugin, {
    vars: { KEY1: "value1", KEY2: "value2" },
  });
  let logs = logPluginOptions(BindingsPlugin, {
    ...wranglerOptions,
    envPath: ".env.custom",
    bindings: { KEY3: "value3", KEY4: "value4" },
    globals: { KEY5: "value5", KEY6: "value6" },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
    textBlobBindings: { TEXT1: "text-blob-1.txt", TEXT2: "text-blob-2.txt" },
    dataBlobBindings: { DATA1: "data-blob-1.bin", DATA2: "data-blob-2.bin" },
    serviceBindings: {
      SERVICE1: "service1",
      SERVICE2: { service: "service2", environment: "development" },
    },
  });
  t.deepEqual(logs, [
    "Env Path: .env.custom",
    "Wrangler Variables: KEY1, KEY2",
    "Custom Bindings: KEY3, KEY4",
    "Custom Globals: KEY5, KEY6",
    "WASM Bindings: MODULE1, MODULE2",
    "Text Blob Bindings: TEXT1, TEXT2",
    "Data Blob Bindings: DATA1, DATA2",
    "Service Bindings: SERVICE1, SERVICE2",
  ]);
  logs = logPluginOptions(BindingsPlugin, { envPath: true });
  t.deepEqual(logs, ["Env Path: .env"]);
  logs = logPluginOptions(BindingsPlugin, { envPath: false });
  t.deepEqual(logs, []);
});

test("BindingsPlugin: uses default .env path if envPathDefaultFallback set and envPath is undefined", (t) => {
  let plugin = new BindingsPlugin(ctx, { envPathDefaultFallback: true });
  t.true(plugin.envPath);

  // Check leaves envPath alone if defined
  plugin = new BindingsPlugin(ctx, {
    envPathDefaultFallback: true,
    envPath: false,
  });
  t.false(plugin.envPath);
  plugin = new BindingsPlugin(ctx, {
    envPathDefaultFallback: true,
    envPath: ".env.custom",
  });
  t.is(plugin.envPath, ".env.custom");
});
test("BindingsPlugin: setup: loads .env bindings from default location", async (t) => {
  const tmp = await useTmp(t);
  const defaultEnvPath = path.join(tmp, ".env");

  let plugin = new BindingsPlugin({ ...ctx, rootPath: tmp }, { envPath: true });
  // Shouldn't throw if file doesn't exist...
  let result = await plugin.setup();
  // ...but should still watch file
  t.deepEqual(result, {
    globals: undefined,
    bindings: {},
    watch: [defaultEnvPath],
  });

  // Create file and try setup again
  await fs.writeFile(defaultEnvPath, "KEY=value");
  result = await plugin.setup();
  t.deepEqual(result, {
    globals: undefined,
    bindings: { KEY: "value" },
    watch: [defaultEnvPath],
  });

  // Check default .env only loaded when envPath set to true
  plugin = new BindingsPlugin({ ...ctx, rootPath: tmp }, {});
  result = await plugin.setup();
  t.deepEqual(result, { globals: undefined, bindings: {}, watch: [] });
});
test("BindingsPlugin: setup: loads .env bindings from custom location", async (t) => {
  const tmp = await useTmp(t);
  const defaultEnvPath = path.join(tmp, ".env");
  const customEnvPath = path.join(tmp, ".env.custom");
  await fs.writeFile(defaultEnvPath, "KEY=default");

  const plugin = new BindingsPlugin(
    { ...ctx, rootPath: tmp },
    // Should resolve envPath relative to rootPath
    { envPath: ".env.custom" }
  );
  // Should throw if file doesn't exist
  await t.throwsAsync(plugin.setup(), {
    code: "ENOENT",
    message: /\.env\.custom/,
  });

  // Create file and try setup again
  await fs.writeFile(customEnvPath, "KEY=custom");
  const result = await plugin.setup();
  t.deepEqual(result, {
    globals: undefined,
    bindings: { KEY: "custom" },
    watch: [customEnvPath],
  });
});
test("BindingsPlugin: setup: includes custom bindings", async (t) => {
  const obj = { a: 1 };
  const plugin = new BindingsPlugin(ctx, { bindings: { obj } });
  const result = await plugin.setup();
  t.is(result.bindings?.obj, obj);
  t.deepEqual(result.watch, []);
});
test("BindingsPlugin: setup: loads WebAssembly bindings", async (t) => {
  let plugin = new BindingsPlugin(ctx, {
    wasmBindings: { ADD: addModulePath },
  });
  let result = await plugin.setup();
  t.not(result.bindings?.ADD, undefined);
  assert(result.bindings?.ADD);
  const instance = new WebAssembly.Instance(result.bindings.ADD);
  assert(typeof instance.exports.add === "function");
  t.is(instance.exports.add(1, 2), 3);

  // Check resolves wasmBindings path relative to rootPath
  plugin = new BindingsPlugin(
    { ...ctx, rootPath: path.dirname(addModulePath) },
    { wasmBindings: { ADD: path.basename(addModulePath) } }
  );
  result = await plugin.setup();
  t.not(result.bindings?.ADD, undefined);
});

test("BindingsPlugin: setup: loads text blob bindings", async (t) => {
  let plugin = new BindingsPlugin(ctx, {
    textBlobBindings: { LOREM_IPSUM: loremIpsumPath },
  });
  let result = await plugin.setup();
  t.is(result.bindings?.LOREM_IPSUM, loremIpsum);

  // Check resolves text blob bindings path relative to rootPath
  plugin = new BindingsPlugin(
    { ...ctx, rootPath: path.dirname(loremIpsumPath) },
    { textBlobBindings: { LOREM_IPSUM: "lorem-ipsum.txt" } }
  );
  result = await plugin.setup();
  t.is(result.bindings?.LOREM_IPSUM, loremIpsum);
});

test("BindingsPlugin: setup: loads data blob bindings", async (t) => {
  let plugin = new BindingsPlugin(ctx, {
    dataBlobBindings: { BINARY_DATA: loremIpsumPath },
  });
  let result = await plugin.setup();
  t.deepEqual(result.bindings?.BINARY_DATA, loremIpsumData);

  // Check resolves data blob bindings path relative to rootPath
  plugin = new BindingsPlugin(
    { ...ctx, rootPath: path.dirname(loremIpsumPath) },
    { dataBlobBindings: { BINARY_DATA: "lorem-ipsum.txt" } }
  );
  result = await plugin.setup();
  t.deepEqual(result.bindings?.BINARY_DATA, loremIpsumData);
});

test("BindingsPlugin: setup: loads bindings from all sources", async (t) => {
  // Bindings should be loaded in this order, from lowest to highest priority:
  // 1) Wrangler [vars]
  // 2) .env Variables
  // 3) WASM Module Bindings
  // 4) Text Blob Bindings
  // 5) Data Blob Bindings
  // 6) Service Bindings
  // 7) Custom Bindings

  // wranglerOptions should contain [kWranglerBindings]
  const wranglerOptions = parsePluginWranglerConfig(BindingsPlugin, {
    vars: { A: "w", B: "w", C: "w", D: "w", E: "w", F: "w", G: "w" },
  });

  const tmp = await useTmp(t);
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, "A=env\nB=env\nC=env\nD=env\nE=env\nF=env");

  const obj = { ping: "pong" };
  const throws = () => {
    throw new Error("Should not be called");
  };
  const plugin = new BindingsPlugin(ctx, {
    ...wranglerOptions,
    wasmBindings: {
      A: addModulePath,
      B: addModulePath,
      C: addModulePath,
      D: addModulePath,
      E: addModulePath,
    },
    textBlobBindings: {
      A: loremIpsumPath,
      B: loremIpsumPath,
      C: loremIpsumPath,
      D: loremIpsumPath,
    },
    dataBlobBindings: {
      A: loremIpsumPath,
      B: loremIpsumPath,
      C: loremIpsumPath,
    },
    serviceBindings: { A: throws, B: throws },
    bindings: { A: obj },
    envPath,
  });
  const result = await plugin.setup();
  assert(result.bindings);

  t.is(result.bindings.G, "w");
  t.is(result.bindings.F, "env");
  t.true(result.bindings.E instanceof WebAssembly.Module);
  t.is(result.bindings.D, loremIpsum);
  t.deepEqual(result.bindings.C, loremIpsumData);
  t.true(result.bindings.B instanceof Fetcher);
  t.is(result.bindings.A, obj);
});

// Service bindings tests
test("Fetcher: hides implementation details", (t) => {
  const throws = () => {
    throw new Error("Should not be called");
  };
  const fetcher = new Fetcher(throws, throws);
  t.deepEqual(getObjectProperties(fetcher), ["fetch"]);
});
test("Fetcher: fetch: throws on illegal invocation", async (t) => {
  const throws = () => {
    throw new Error("Should not be called");
  };
  const fetcher = new Fetcher(throws, throws);
  // @ts-expect-error using comma expression to unbind this
  // noinspection CommaExpressionJS
  await t.throwsAsync(() => (0, fetcher.fetch)("http://localhost"), {
    instanceOf: TypeError,
    message: "Illegal invocation",
  });
});
test("BindingsPlugin: dispatches fetch to mounted service", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      name: "a",
      modules: true,
      script: `export default {
        fetch(request, env) {
          const { pathname } = new URL(request.url);
          if (pathname === "/ping") {
            return new Response("pong");
          }
          return env.SERVICE_B.fetch("http://localhost/test", { method: "POST" });
        }
      }`,
      serviceBindings: {
        SERVICE_B: { service: "b", environment: "production" },
      },
      mounts: {
        b: {
          name: "b",
          modules: true,
          script: `export default {
            async fetch(request, env) {
              const res = await env.SERVICE_A.fetch("http://localhost/ping");
              const text = await res.text();
              return new Response(request.method + " " + request.url + ":" + text);
            }
          }`,
          // Implicitly testing service binding shorthand
          serviceBindings: { SERVICE_A: "a" },
        },
      },
    }
  );
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "POST http://localhost/test:pong");
});
test("BindingsPlugin: dispatches fetch to custom service", async (t) => {
  const plugin = new BindingsPlugin(ctx, {
    serviceBindings: {
      async SERVICE(request) {
        return new Response(`${request.method} ${request.url}`);
      },
    },
  });
  const { bindings } = await plugin.setup();
  let res = await bindings!.SERVICE.fetch("http://localhost/", {
    method: "POST",
  });
  t.is(await res.text(), "POST http://localhost/");

  // No need to run beforeReload()/reload() hooks here, but just check that
  // running them doesn't break anything
  plugin.beforeReload();
  plugin.reload({}, {}, new Map());
  res = await bindings!.SERVICE.fetch("http://localhost/test");
  t.is(await res.text(), "GET http://localhost/test");
});
test("BindingsPlugin: uses mounted service's usage model when dispatching fetch to mounted service", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin, CachePlugin },
    {
      name: "a",
      modules: true,
      usageModel: "bundled",
      script: `export default {
        fetch(request, env) {
          return env.SERVICE_B.fetch("http://localhost/");
        }
      }`,
      serviceBindings: { SERVICE_B: "b" },
      mounts: {
        b: {
          name: "b",
          modules: true,
          usageModel: "unbound",
          script: `export default {
            async fetch(request, env) {
              await Promise.all(Array.from(Array(1000)).map(() => caches.default.match("http://localhost/")));
              return new Response("body");
            }
          }`,
        },
      },
    }
  );
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "body");
});
test("BindingsPlugin: uses parent's usage model when dispatching fetch from mounted service", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin, CachePlugin },
    {
      name: "a",
      modules: true,
      usageModel: "unbound",
      script: `export default {
        async fetch(request, env) {
          const { pathname } = new URL(request.url);
          if (pathname === "/ping") {
            await Promise.all(Array.from(Array(1000)).map(() => caches.default.match("http://localhost/")));
            return new Response("pong");
          }
          return env.SERVICE_B.fetch("http://localhost/");
        }
      }`,
      serviceBindings: { SERVICE_B: "b" },
      mounts: {
        b: {
          name: "b",
          modules: true,
          usageModel: "bundled",
          script: `export default {
            fetch(request, env) {
              return env.SERVICE_A.fetch("http://localhost/ping");
            }
          }`,
          serviceBindings: { SERVICE_A: "a" },
        },
      },
    }
  );
  const res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "pong");
});
test("BindingsPlugin: uses plugin context's usage model when dispatching to custom service", async (t) => {
  async function SERVICE() {
    getRequestContext()?.incrementExternalSubrequests(1000);
    return new Response("body");
  }

  let plugin = new BindingsPlugin(
    { ...ctx, usageModel: "bundled" },
    { serviceBindings: { SERVICE } }
  );
  let bindings = (await plugin.setup()).bindings;
  await t.throwsAsync(bindings!.SERVICE.fetch("http://localhost/"));

  plugin = new BindingsPlugin(
    { ...ctx, usageModel: "unbound" },
    { serviceBindings: { SERVICE } }
  );
  bindings = (await plugin.setup()).bindings;
  const res = await bindings!.SERVICE.fetch("http://localhost/");
  t.is(await res.text(), "body");
});
test("BindingsPlugin: waits for services before dispatching", async (t) => {
  const plugin = new BindingsPlugin(ctx, {
    // Implicitly testing service binding without environment
    serviceBindings: { SERVICE: { service: "a" } },
  });
  const { bindings } = await plugin.setup();
  plugin.beforeReload();
  // Simulate fetching before reload complete
  const res = bindings!.SERVICE.fetch("http://localhost/");
  await setImmediate();
  const mount: _CoreMount = {
    dispatchFetch: async () => new Response("a service"),
    usageModel: "bundled",
  };
  plugin.reload({}, {}, new Map([["a", mount]]));
  t.is(await (await res).text(), "a service");
});
test("BindingsPlugin: reload: throws if service isn't mounted", async (t) => {
  let plugin = new BindingsPlugin(ctx, {
    serviceBindings: { SERVICE: "a" },
  });
  await plugin.setup();
  plugin.beforeReload();
  t.throws(() => plugin.reload({}, {}, new Map()), {
    instanceOf: MiniflareCoreError,
    code: "ERR_SERVICE_NOT_MOUNTED",
    message:
      'Service "a" for binding "SERVICE" not found.\nMake sure "a" is mounted so Miniflare knows where to find it.',
  });

  // Check doesn't throw if using custom fetch function
  plugin = new BindingsPlugin(ctx, {
    serviceBindings: { SERVICE: () => new Response() },
  });
  await plugin.setup();
  plugin.beforeReload();
  plugin.reload({}, {}, new Map());
  t.pass();
});
test("BindingsPlugin: reloads service bindings used by mount when another mounted worker reloads", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      mounts: {
        a: {
          modules: true,
          routes: ["*"],
          script: `export default {
            async fetch(request, env) {
              const res = await env.SERVICE_B.fetch("http://localhost/");
              return new Response("a" + await res.text());              
            }
          }`,
          serviceBindings: { SERVICE_B: "b" },
        },
        b: {
          modules: true,
          script: `export default { fetch: () => new Response("b1") }`,
        },
      },
    }
  );
  let res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "ab1");

  // Update "b" and check new response
  const b = await mf.getMount("b");
  await b.setOptions({
    script: `export default { fetch: () => new Response("b2") }`,
  });

  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "ab2");
});
test("BindingsPlugin: passes through when service doesn't respond", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      name: "parent",
      script: 'addEventListener("fetch", () => {})',
      mounts: {
        a: { script: 'addEventListener("fetch", () => {})' },
        b: {
          modules: true,
          script: `export default {
            fetch(request, env, ctx) {
              ctx.passThroughOnException();
              throw new Error("oops");
            }
          }`,
        },
        c: {
          modules: true,
          routes: ["*/*"],
          script: `export default {
            async fetch(request, env) {
              const { pathname } = new URL(request.url);
              const name = pathname === "/a" ? "SERVICE_A" 
                : pathname === "/b" ? "SERVICE_B" : "SERVICE_PARENT";
              const service = env[name];
              const res = await service.fetch(${JSON.stringify(upstream)});
              return new Response(name + ":" + await res.text());
            }
          }`,
          serviceBindings: {
            SERVICE_A: "a",
            SERVICE_B: "b",
            SERVICE_PARENT: "parent",
          },
        },
      },
    }
  );
  // Check with both another mounted service and the parent and when
  // passThroughOnException() is called
  let res = await mf.dispatchFetch("http://localhost/a");
  t.is(await res.text(), "SERVICE_A:upstream");
  res = await mf.dispatchFetch("http://localhost/b");
  t.is(await res.text(), "SERVICE_B:upstream");
  res = await mf.dispatchFetch("http://localhost/parent");
  t.is(await res.text(), "SERVICE_PARENT:upstream");
});
test("BindingsPlugin: propagates error if service throws", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      modules: true,
      script: `export default {
        async fetch(request, env) {
          await env.SERVICE.fetch(request);
          return new Response("body");
        } ,
      }`,
      serviceBindings: { SERVICE: "a" },
      mounts: {
        a: {
          modules: true,
          script: `export default {
            fetch: () => { throw new Error("oops"); },
          }`,
        },
      },
    }
  );
  await t.throwsAsync(mf.dispatchFetch("http://localhost/"), {
    message: "oops",
  });
});
test("BindingsPlugin: service fetch creates new request context", async (t) => {
  // noinspection JSUnusedGlobalSymbols
  const bindings = {
    assertSubrequests(expected: number) {
      t.is(getRequestContext()?.externalSubrequests, expected);
    },
  };

  const mf = useMiniflare(
    { BindingsPlugin, CachePlugin },
    {
      bindings,
      serviceBindings: { SERVICE: "a" },
      modules: true,
      script: `export default {
        async fetch(request, env) {
          env.assertSubrequests(0);
          await caches.default.match("http://localhost/");
          env.assertSubrequests(1);
          return await env.SERVICE.fetch(request);
        },
      }`,
      mounts: {
        a: {
          bindings,
          modules: true,
          script: `export default {
            async fetch(request, env) {
              env.assertSubrequests(0);
              await caches.default.match("http://localhost/");
              env.assertSubrequests(1);
              
              const n = parseInt(new URL(request.url).searchParams.get("n"));
              await Promise.all(
                Array.from(Array(n)).map(() => caches.default.match("http://localhost/"))
              );
              return new Response("body");
            },
          }`,
        },
      },
    }
  );
  await t.throwsAsync(mf.dispatchFetch("http://localhost/?n=50"), {
    instanceOf: Error,
    message: /^Too many subrequests/,
  });
  const res = await mf.dispatchFetch("http://localhost/?n=1");
  t.is(await res.text(), "body");
});
test("BindingsPlugin: service fetch increases pipeline depth", async (t) => {
  const depths: [request: number, pipeline: number][] = [];
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      bindings: {
        recordDepth() {
          const ctx = getRequestContext()!;
          depths.push([ctx.requestDepth, ctx.pipelineDepth]);
        },
      },
      modules: true,
      name: "service",
      serviceBindings: { SERVICE: "service" },
      script: `export default {
        async fetch(request, env) {
          env.recordDepth();
        
          const url = new URL(request.url);
          const n = parseInt(url.searchParams.get("n") ?? "0");
          if (n === 0) return new Response("end");
          url.searchParams.set("n", n - 1);
          
          const res = await env.SERVICE.fetch(url);
          return new Response(\`\${n},\${await res.text()}\`);
        }
      }`,
    }
  );

  const res = await mf.dispatchFetch("http://localhost/?n=3");
  t.is(await res.text(), "3,2,1,end");
  t.deepEqual(depths, [
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
  ]);

  await mf.dispatchFetch("http://localhost/?n=31"); // Shouldn't throw
  await t.throwsAsync(mf.dispatchFetch("http://localhost/?n=32"), {
    instanceOf: Error,
    message:
      /^Subrequest depth limit exceeded.+\nService bindings can recurse up to 32 times\./,
  });
});
test("BindingsPlugin: service fetch returns response with immutable headers", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/346
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      modules: true,
      serviceBindings: {
        SERVICE() {
          return new Response();
        },
      },
      script: `export default {
        async fetch(request, env) {
          const res = await env.SERVICE.fetch(request);
          res.headers.set("X-Key", "value");
          return res;
        }
      }`,
    }
  );

  await t.throwsAsync(mf.dispatchFetch("http://localhost"), {
    instanceOf: TypeError,
    message: "immutable",
  });
});
