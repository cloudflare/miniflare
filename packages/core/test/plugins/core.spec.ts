import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { text } from "stream/consumers";
import type {
  CompressionStream,
  DecompressionStream,
  ReadableWritablePair,
  Transformer,
} from "stream/web";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";
import {
  CorePlugin,
  IdentityTransformStream,
  Request,
  Response,
  Scheduler,
} from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  RequestContext,
  STRING_SCRIPT_PATH,
} from "@miniflare/shared";
import {
  TestLog,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  triggerPromise,
  unusable,
  useServer,
  useTmp,
  utf8Encode,
} from "@miniflare/shared-test";
import test, { ThrowsExpectation } from "ava";
import { File, FormData } from "undici";

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
  globalAsyncIO: true,
  sharedCache: unusable(),
};
test("CorePlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(CorePlugin, [
    "script.js",
    "--wrangler-config",
    "wrangler.custom.toml",
    "--wrangler-env",
    "dev",
    "--package",
    "package.custom.json",
    "--modules",
    "--modules-rule",
    "Text=*.txt",
    "--modules-rule",
    "Data=*.png",
    "--compat-date",
    "2021-10-23",
    "--compat-flag",
    "fetch_refuses_unknown_protocols",
    "--compat-flag",
    "durable_object_fetch_allows_relative_url",
    "--usage-model",
    "unbound",
    "--upstream",
    "https://github.com/mrbbot",
    "--watch",
    "--debug",
    "--verbose",
    "--no-update-check",
    "--repl",
    "--root",
    "root",
    "--mount",
    "api=./api",
    "--mount",
    "site=./site@dev",
    "--name",
    "worker",
    "--route",
    "https://miniflare.dev/*",
    "--route",
    "dev.miniflare.dev/*",
    "--global-async-io",
    "--global-timers",
    "--global-random",
    "--actual-time",
  ]);
  t.deepEqual(options, {
    scriptPath: "script.js",
    wranglerConfigPath: "wrangler.custom.toml",
    wranglerConfigEnv: "dev",
    packagePath: "package.custom.json",
    modules: true,
    modulesRules: [
      { type: "Text", include: ["*.txt"], fallthrough: true },
      { type: "Data", include: ["*.png"], fallthrough: true },
    ],
    compatibilityDate: "2021-10-23",
    compatibilityFlags: [
      "fetch_refuses_unknown_protocols",
      "durable_object_fetch_allows_relative_url",
    ],
    usageModel: "unbound",
    upstream: "https://github.com/mrbbot",
    watch: true,
    debug: true,
    verbose: true,
    updateCheck: false,
    repl: true,
    rootPath: "root",
    mounts: {
      api: {
        rootPath: "./api",
        wranglerConfigEnv: undefined,
        packagePath: true,
        envPathDefaultFallback: true,
        wranglerConfigPath: true,
      },
      site: {
        rootPath: "./site",
        wranglerConfigEnv: "dev",
        packagePath: true,
        envPathDefaultFallback: true,
        wranglerConfigPath: true,
      },
    },
    name: "worker",
    routes: ["https://miniflare.dev/*", "dev.miniflare.dev/*"],
    globalAsyncIO: true,
    globalTimers: true,
    globalRandom: true,
    actualTime: true,
  });
  options = parsePluginArgv(CorePlugin, [
    "-c",
    "wrangler.custom.toml",
    "-m",
    "-u",
    "https://miniflare.dev",
    "-wdV",
  ]);
  t.deepEqual(options, {
    wranglerConfigPath: "wrangler.custom.toml",
    modules: true,
    upstream: "https://miniflare.dev",
    watch: true,
    debug: true,
    verbose: true,
  });
});
test("CorePlugin: parses options from wrangler config", async (t) => {
  const configDir = await useTmp(t);
  let options = parsePluginWranglerConfig(
    CorePlugin,
    {
      name: "test-service",
      compatibility_date: "2021-10-23",
      compatibility_flags: [
        "fetch_refuses_unknown_protocols",
        "durable_object_fetch_allows_relative_url",
      ],
      build: {
        upload: {
          format: "modules",
          main: "script.mjs",
          dir: "src",
          rules: [
            { type: "Text", globs: ["*.txt"], fallthrough: true },
            { type: "Data", globs: ["*.png"] },
          ],
        },
      },
      route: "miniflare.dev/*",
      routes: [
        "dev.miniflare.dev/*",
        { pattern: "dev_with_zone_id.miniflare.dev/*", zone_id: "" },
        { pattern: "dev_with_zone_name.miniflare.dev/*", zone_name: "" },
      ],
      usage_model: "unbound",
      miniflare: {
        upstream: "https://miniflare.dev",
        watch: true,
        update_check: false,
        mounts: { api: "./api", site: "./site@dev" },
        route: "http://localhost:8787/*",
        routes: [
          "miniflare.mf:8787/*",
          { pattern: "dev_with_zone_id.miniflare.mf:8787/*", zone_id: "" },
          { pattern: "dev_with_zone_name.miniflare.mf:8787/*", zone_name: "" },
        ],
        global_async_io: true,
        global_timers: true,
        global_random: true,
        actual_time: true,
        inaccurate_cpu: true,
      },
    },
    configDir
  );
  t.deepEqual(options, {
    script: undefined,
    wranglerConfigPath: undefined,
    wranglerConfigEnv: undefined,
    packagePath: undefined,
    scriptPath: path.resolve(configDir, "src", "script.mjs"),
    modules: true,
    modulesRules: [
      { type: "Text", include: ["*.txt"], fallthrough: true },
      { type: "Data", include: ["*.png"], fallthrough: undefined },
    ],
    compatibilityDate: "2021-10-23",
    compatibilityFlags: [
      "fetch_refuses_unknown_protocols",
      "durable_object_fetch_allows_relative_url",
    ],
    usageModel: "unbound",
    upstream: "https://miniflare.dev",
    watch: true,
    debug: undefined,
    fetchMock: undefined,
    verbose: undefined,
    updateCheck: false,
    repl: undefined,
    rootPath: undefined,
    mounts: {
      api: {
        rootPath: path.resolve(configDir, "api"),
        wranglerConfigEnv: undefined,
        packagePath: true,
        envPathDefaultFallback: true,
        wranglerConfigPath: true,
      },
      site: {
        rootPath: path.resolve(configDir, "site"),
        wranglerConfigEnv: "dev",
        packagePath: true,
        envPathDefaultFallback: true,
        wranglerConfigPath: true,
      },
    },
    name: "test-service",
    routes: [
      "miniflare.dev/*",
      "dev.miniflare.dev/*",
      "dev_with_zone_id.miniflare.dev/*",
      "dev_with_zone_name.miniflare.dev/*",
      "http://localhost:8787/*",
      "miniflare.mf:8787/*",
      "dev_with_zone_id.miniflare.mf:8787/*",
      "dev_with_zone_name.miniflare.mf:8787/*",
    ],
    logUnhandledRejections: undefined,
    globalAsyncIO: true,
    globalTimers: true,
    globalRandom: true,
    actualTime: true,
    inaccurateCpu: true,
  });
  // Check build upload dir defaults to dist
  options = parsePluginWranglerConfig(
    CorePlugin,
    { build: { upload: { main: "script.js" } } },
    configDir
  );
  t.is(options.scriptPath, path.resolve(configDir, "dist", "script.js"));
  t.is(options.routes, undefined);
  // Check live_reload implies watch
  options = parsePluginWranglerConfig(CorePlugin, {
    miniflare: { live_reload: true },
  });
  t.true(options.watch);
  options = parsePluginWranglerConfig(CorePlugin, {
    miniflare: { live_reload: false },
  });
  t.is(options.watch, undefined);
});
test("CorePlugin: logs options", (t) => {
  let logs = logPluginOptions(CorePlugin, {
    script: "console.log('Hello!')",
    scriptPath: "script.js",
    wranglerConfigPath: "wrangler.custom.toml",
    wranglerConfigEnv: "dev",
    packagePath: "package.custom.json",
    modules: true,
    modulesRules: [
      { type: "Text", include: ["*.txt"], fallthrough: true },
      { type: "Data", include: ["*.png", "*.jpg"] },
    ],
    usageModel: "unbound",
    upstream: "https://miniflare.dev",
    watch: true,
    debug: true,
    verbose: true,
    repl: true,
    rootPath: "root",
    mounts: { api: "./api", site: "./site" },
    name: "worker",
    routes: ["https://miniflare.dev/*", "dev.miniflare.dev/*"],
    globalAsyncIO: true,
    globalTimers: true,
    globalRandom: true,
    actualTime: true,
    inaccurateCpu: true,
  });
  t.deepEqual(logs, [
    // script is OptionType.NONE so omitted
    "Script Path: script.js",
    "Wrangler Config Path: wrangler.custom.toml",
    "Wrangler Environment: dev",
    "Package Path: package.custom.json",
    "Modules: true",
    "Modules Rules: {Text: *.txt}, {Data: *.png, *.jpg}",
    "Usage Model: unbound",
    "Upstream: https://miniflare.dev",
    "Watch: true",
    "Debug: true",
    "Verbose: true",
    "REPL: true",
    "Root Path: root",
    "Mounts: api, site",
    "Name: worker",
    "Routes: https://miniflare.dev/*, dev.miniflare.dev/*",
    "Allow Global Async I/O: true",
    "Allow Global Timers: true",
    "Allow Global Secure Random: true",
    "Actual Time: true",
    "Inaccurate CPU Time Measurements: true",
  ]);
  // Check logs default wrangler config/package paths
  logs = logPluginOptions(CorePlugin, {
    wranglerConfigPath: true,
    packagePath: true,
  });
  t.deepEqual(logs, [
    "Wrangler Config Path: wrangler.toml",
    "Package Path: package.json",
  ]);
  // Check doesn't log wrangler config/package paths if explicitly disabled
  logs = logPluginOptions(CorePlugin, {});
  t.deepEqual(logs, []);
  logs = logPluginOptions(CorePlugin, {
    wranglerConfigPath: false,
    packagePath: false,
  });
  t.deepEqual(logs, []);
});

test("CorePlugin: setup: includes web standards", async (t) => {
  const plugin = new CorePlugin({
    ...ctx,
    compat: new Compatibility(undefined, [
      "streams_enable_constructors",
      "transformstream_enable_standard_constructor",
    ]),
  });
  const { globals } = await plugin.setup();
  assert(globals);

  t.is(typeof globals.console, "object");

  t.is(typeof globals.setTimeout, "function");
  t.is(typeof globals.setInterval, "function");
  t.is(typeof globals.clearTimeout, "function");
  t.is(typeof globals.clearInterval, "function");
  t.is(typeof globals.queueMicrotask, "function");
  t.is(typeof globals.scheduler.wait, "function");

  t.is(typeof globals.atob, "function");
  t.is(typeof globals.btoa, "function");

  t.is(typeof globals.crypto, "object");
  t.is(typeof globals.CryptoKey, "function");
  t.is(typeof globals.TextDecoder, "function");
  t.is(typeof globals.TextEncoder, "function");

  t.is(typeof globals.fetch, "function");
  t.is(typeof globals.Headers, "function");
  t.is(typeof globals.Request, "function");
  t.is(typeof globals.Response, "function");
  t.is(typeof globals.FormData, "function");
  t.is(typeof globals.Blob, "function");
  t.is(typeof globals.File, "function");
  t.is(typeof globals.URL, "function");
  t.is(typeof globals.URLSearchParams, "function");
  t.is(typeof globals.URLPattern, "function");

  t.is(typeof globals.ReadableStream, "function");
  t.is(typeof globals.WritableStream, "function");
  t.is(typeof globals.TransformStream, "function");

  t.is(typeof globals.ReadableStreamBYOBReader, "function");
  t.is(typeof globals.ReadableStreamDefaultReader, "function");
  t.is(typeof globals.WritableStreamDefaultWriter, "function");

  t.is(typeof globals.ByteLengthQueuingStrategy, "function");
  t.is(typeof globals.CountQueuingStrategy, "function");

  t.is(typeof globals.ReadableByteStreamController, "function");
  t.is(typeof globals.ReadableStreamBYOBRequest, "function");
  t.is(typeof globals.ReadableStreamDefaultController, "function");
  t.is(typeof globals.WritableStreamDefaultController, "function");
  t.is(typeof globals.TransformStreamDefaultController, "function");

  t.is(typeof globals.IdentityTransformStream, "function");
  t.is(typeof globals.FixedLengthStream, "function");

  t.is(typeof globals.CompressionStream, "function");
  t.is(typeof globals.DecompressionStream, "function");
  t.is(typeof globals.TextEncoderStream, "function");
  t.is(typeof globals.TextDecoderStream, "function");

  t.is(typeof globals.Event, "function");
  t.is(typeof globals.EventTarget, "function");
  t.is(typeof globals.AbortController, "function");
  t.is(typeof globals.AbortSignal, "function");
  t.is(typeof globals.FetchEvent, "function");
  t.is(typeof globals.ScheduledEvent, "function");

  t.is(typeof globals.DOMException, "function");
  t.is(typeof globals.WorkerGlobalScope, "function");

  t.is(typeof globals.structuredClone, "function");

  t.is(typeof globals.ArrayBuffer, "function");
  t.is(typeof globals.Atomics, "object");
  t.is(typeof globals.BigInt64Array, "function");
  t.is(typeof globals.BigUint64Array, "function");
  t.is(typeof globals.DataView, "function");
  t.is(typeof globals.Date, "function");
  t.is(typeof globals.Float32Array, "function");
  t.is(typeof globals.Float64Array, "function");
  t.is(typeof globals.Int8Array, "function");
  t.is(typeof globals.Int16Array, "function");
  t.is(typeof globals.Int32Array, "function");
  t.is(typeof globals.Map, "function");
  t.is(typeof globals.Set, "function");
  t.is(typeof globals.SharedArrayBuffer, "function");
  t.is(typeof globals.Uint8Array, "function");
  t.is(typeof globals.Uint8ClampedArray, "function");
  t.is(typeof globals.Uint16Array, "function");
  t.is(typeof globals.Uint32Array, "function");
  t.is(typeof globals.WeakMap, "function");
  t.is(typeof globals.WeakSet, "function");
  t.is(typeof globals.WebAssembly, "object");

  t.true(globals.MINIFLARE);
});
test("CorePlugin: setup: timer operations throw outside request handler unless globalTimers set", async (t) => {
  interface Globals {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    scheduler: Scheduler;
  }

  let plugin = new CorePlugin(ctx);
  let globals = (await plugin.setup()).globals as Globals;
  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };

  // Get an instance of Node's stranger Timeout type
  const timeout = setTimeout(() => {});
  t.throws(() => globals.setTimeout(() => {}), expectations);
  t.throws(() => globals.clearTimeout(timeout), expectations);
  t.throws(() => globals.setInterval(() => {}), expectations);
  t.throws(() => globals.clearInterval(timeout), expectations);
  await t.throwsAsync(async () => globals.scheduler.wait(0), expectations);

  // Check with globalTimers set
  plugin = new CorePlugin(ctx, { globalTimers: true });
  globals = (await plugin.setup()).globals as Globals;
  globals.clearTimeout(globals.setTimeout(() => {}));
  globals.clearInterval(globals.setInterval(() => {}));
  await globals.scheduler.wait(0);
});
test("CorePlugin: setup: secure random operations throw outside request handler unless globalRandom set", async (t) => {
  type Crypto = typeof import("crypto").webcrypto;
  let plugin = new CorePlugin(ctx);
  let crypto = (await plugin.setup()).globals?.crypto as Crypto;
  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  };

  const args: Parameters<typeof crypto.subtle.generateKey> = [
    { name: "aes-gcm", length: 256 } as any,
    true,
    ["encrypt", "decrypt"],
  ];
  t.throws(() => crypto.getRandomValues(new Uint8Array(8)), expectations);
  t.throws(() => crypto.subtle.generateKey(...args), expectations);

  // Check with globalRandom set
  plugin = new CorePlugin(ctx, { globalRandom: true });
  crypto = (await plugin.setup()).globals?.crypto as Crypto;
  crypto.getRandomValues(new Uint8Array(8));
  await crypto.subtle.generateKey(...args);
});
test("CorePlugin: setup: fetch refuses unknown protocols only if compatibility flag enabled", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  upstream.protocol = "ftp:";

  let plugin = new CorePlugin(ctx);
  let { globals } = await plugin.setup();
  const res = await globals?.fetch(upstream);
  t.is(await res.text(), "upstream");

  const compat = new Compatibility(undefined, [
    "fetch_refuses_unknown_protocols",
  ]);
  plugin = new CorePlugin({ ...ctx, compat });
  globals = (await plugin.setup()).globals;
  await t.throwsAsync(async () => globals?.fetch(upstream), {
    instanceOf: TypeError,
    message: `Fetch API cannot load: ${upstream.toString()}`,
  });
});
test("CorePlugin: setup: fetch throws outside request handler unless globalAsyncIO set", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  let plugin = new CorePlugin({ ...ctx, globalAsyncIO: false });
  let { globals } = await plugin.setup();
  await t.throwsAsync(globals?.fetch(upstream), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });
  plugin = new CorePlugin({ ...ctx, globalAsyncIO: true });
  globals = (await plugin.setup()).globals;
  await globals?.fetch(upstream);
});
test("CorePlugin: setup: Request parses files in FormData as File objects only if compatibility flag enabled", async (t) => {
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  let plugin = new CorePlugin(ctx);
  let CompatRequest: typeof Request = (await plugin.setup()).globals?.Request;
  let req = new CompatRequest("http://localhost", {
    method: "POST",
    body: formData,
  });
  let reqFormData = await req.formData();
  t.is(reqFormData.get("file"), "test");

  const compat = new Compatibility(undefined, [
    "formdata_parser_supports_files",
  ]);
  plugin = new CorePlugin({ ...ctx, compat });
  CompatRequest = (await plugin.setup()).globals?.Request;
  req = new CompatRequest("http://localhost", {
    method: "POST",
    body: formData,
  });
  reqFormData = await req.formData();
  t.true(reqFormData.get("file") instanceof File);
});
test("CorePlugin: setup: Response parses files in FormData as File objects only if compatibility flag enabled", async (t) => {
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  let plugin = new CorePlugin(ctx);
  let CompatResponse: typeof Response = (await plugin.setup()).globals
    ?.Response;
  let res = new CompatResponse(formData);
  let resFormData = await res.formData();
  t.is(resFormData.get("file"), "test");

  const compat = new Compatibility(undefined, [
    "formdata_parser_supports_files",
  ]);
  plugin = new CorePlugin({ ...ctx, compat });
  CompatResponse = (await plugin.setup()).globals?.Response;
  res = new CompatResponse(formData);
  resFormData = await res.formData();
  t.true(resFormData.get("file") instanceof File);
});
test("CorePlugin: setup: includes navigator only if compatibility flag enabled", async (t) => {
  let plugin = new CorePlugin(ctx);
  let globals = (await plugin.setup()).globals;
  t.is(globals?.navigator, undefined);

  const compat = new Compatibility(undefined, ["global_navigator"]);
  plugin = new CorePlugin({ ...ctx, compat });
  globals = (await plugin.setup()).globals;
  t.is(globals?.navigator.userAgent, "Cloudflare-Workers");
});
test("CorePlugin: setup: uses actual time if option enabled", async (t) => {
  let plugin = new CorePlugin(ctx);
  let DateImpl: typeof Date = (await plugin.setup()).globals?.Date;
  await new RequestContext().runWith(async () => {
    const previous = DateImpl.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    t.is(DateImpl.now(), previous);
  });

  plugin = new CorePlugin(ctx, { actualTime: true });
  DateImpl = (await plugin.setup()).globals?.Date;
  await new RequestContext().runWith(async () => {
    const previous = DateImpl.now();
    await new Promise((resolve) => setTimeout(resolve, 100));
    t.not(DateImpl.now(), previous);
  });
});

test("CorePlugin: nodejs_compat compatibility flag includes Node.js modules", async (t) => {
  let compat = new Compatibility(undefined, ["nodejs_compat"]);
  let plugin = new CorePlugin({ ...ctx, compat });
  let modules = (await plugin.setup()).additionalModules!;
  const names = Object.keys(modules).sort();
  t.deepEqual(names, [
    "node:assert",
    "node:async_hooks",
    "node:buffer",
    "node:events",
    "node:util",
  ]);

  compat = new Compatibility(undefined, ["nodejs_compat", "experimental"]);
  plugin = new CorePlugin({ ...ctx, compat });
  modules = (await plugin.setup()).additionalModules!;
  const experimentalNames = Object.keys(modules).filter(
    (name) => !names.includes(name)
  );
  t.deepEqual(experimentalNames, []);

  // We're using Node's implementations of these modules' exports, so don't
  // bother testing their functionality. Instead, just check we've got the
  // same export types as `workerd`.

  function exportTypes(name: string): Record<string, string> {
    return Object.fromEntries(
      Object.entries(modules[name]).map(([key, value]) => [key, typeof value])
    );
  }

  t.deepEqual(exportTypes("node:assert"), {
    AssertionError: "function",
    deepEqual: "function",
    deepStrictEqual: "function",
    default: "function",
    doesNotMatch: "function",
    doesNotReject: "function",
    doesNotThrow: "function",
    equal: "function",
    fail: "function",
    ifError: "function",
    match: "function",
    notDeepEqual: "function",
    notDeepStrictEqual: "function",
    notEqual: "function",
    notStrictEqual: "function",
    ok: "function",
    rejects: "function",
    strict: "function",
    strictEqual: "function",
    throws: "function",
  });
  t.deepEqual(exportTypes("node:async_hooks"), {
    AsyncLocalStorage: "function",
    AsyncResource: "function",
    default: "object",
  });
  t.deepEqual(exportTypes("node:buffer"), {
    Buffer: "function",
    SlowBuffer: "function",
    constants: "object",
    default: "object",
    kMaxLength: "number",
    kStringMaxLength: "number",
  });
  t.deepEqual(exportTypes("node:events"), {
    EventEmitter: "function",
    // Miniflare's minimum support Node version is `16.13.0`, but
    // `EventEmitterAsyncResource` was only added in `16.14.0`:
    // https://nodejs.org/api/events.html#class-eventseventemitterasyncresource-extends-eventemitter
    EventEmitterAsyncResource: process.versions.node.startsWith("16.13.")
      ? "undefined"
      : "function",
    captureRejectionSymbol: "symbol",
    default: "function",
    defaultMaxListeners: "number",
    errorMonitor: "symbol",
    getEventListeners: "function",
    listenerCount: "function",
    on: "function",
    once: "function",
    setMaxListeners: "function",
  });
  t.deepEqual(exportTypes("node:util"), {
    _extend: "function",
    callbackify: "function",
    default: "object",
    format: "function",
    inherits: "function",
    promisify: "function",
    types: "object",
  });
});

// Test stream constructors
test("CorePlugin: setup: ReadableStream/WriteableStream constructors only enabled if compatibility flag enabled", async (t) => {
  // Check without "streams_enable_constructors" compatibility flag (should throw)
  let plugin = new CorePlugin(ctx);
  let globals = (await plugin.setup()).globals!;

  let ReadableStreamImpl: typeof ReadableStream = globals.ReadableStream;
  await t.throws(
    () => {
      new ReadableStreamImpl({
        start(controller) {
          controller.enqueue("chunk");
          controller.close();
        },
      });
    },
    {
      instanceOf: Error,
      message:
        "To use the new ReadableStream() constructor, enable the streams_enable_constructors feature flag.",
    }
  );

  let WritableStreamImpl: typeof WritableStream = globals.WritableStream;
  await t.throws(
    () => {
      new WritableStreamImpl({ write: (chunk) => t.fail(chunk) });
    },
    {
      instanceOf: Error,
      message:
        "To use the new WritableStream() constructor, enable the streams_enable_constructors feature flag.",
    }
  );

  // Check with "streams_enable_constructors" compatibility flag
  plugin = new CorePlugin({
    ...ctx,
    compat: new Compatibility(undefined, ["streams_enable_constructors"]),
  });
  globals = (await plugin.setup()).globals!;

  ReadableStreamImpl = globals.ReadableStream;
  const readable = new ReadableStreamImpl({
    start(controller) {
      controller.enqueue("chunk");
      controller.close();
    },
  });
  t.is(await text(readable as any), "chunk");

  WritableStreamImpl = globals.WritableStream;
  const [trigger, promise] = triggerPromise<any>();
  const writable = new WritableStreamImpl({ write: (chunk) => trigger(chunk) });
  const writer = writable.getWriter();
  await writer.write("chunk");
  await writer.close();
  t.is(await promise, "chunk");
});
test("CorePlugin: setup: TransformStream accepts custom transformer only if compatibility flags enabled", async (t) => {
  async function writeThrough<T>(
    stream: ReadableWritablePair<T>,
    chunks: T[]
  ): Promise<T[]> {
    const writer = stream.writable.getWriter();
    for (const chunk of chunks) {
      // noinspection ES6MissingAwait
      void writer.write(chunk);
    }
    // noinspection ES6MissingAwait
    void writer.close();

    const result: T[] = [];
    for await (const chunk of stream.readable) result.push(chunk);
    return result;
  }

  const upperCaseTransformer: Transformer<string, string> = {
    transform(chunk, controller) {
      controller.enqueue(chunk.toUpperCase());
    },
  };

  // Check without any flags
  // (should behave like `IdentityTransformStream`, and warn if transformer passed)
  const log = new TestLog();
  let plugin = new CorePlugin({ ...ctx, log });
  let globals = (await plugin.setup()).globals!;
  let TransformStreamImpl: typeof TransformStream = globals.TransformStream;

  let stream = new TransformStreamImpl();
  t.true(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), []);
  t.deepEqual(await writeThrough(stream, [new Uint8Array([1, 2, 3])]), [
    new Uint8Array([1, 2, 3]),
  ]);

  stream = new TransformStreamImpl(upperCaseTransformer);
  t.true(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), [
    "To use the new TransformStream() constructor with a custom transformer, enable the transformstream_enable_standard_constructor feature flag.",
  ]);
  t.deepEqual(await writeThrough(stream, [new Uint8Array([1, 2, 3])]), [
    new Uint8Array([1, 2, 3]),
  ]);

  // Check with just "streams_enable_constructors" compatibility flag
  // (should behave like `IdentityTransformStream`, and warn if transformer passed)
  log.logs = [];
  let compat = new Compatibility(undefined, ["streams_enable_constructors"]);
  plugin = new CorePlugin({ ...ctx, log, compat });
  globals = (await plugin.setup()).globals!;
  TransformStreamImpl = globals.TransformStream;

  stream = new TransformStreamImpl();
  t.true(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), []);
  t.deepEqual(await writeThrough(stream, [new Uint8Array([1, 2, 3])]), [
    new Uint8Array([1, 2, 3]),
  ]);

  stream = new TransformStreamImpl(upperCaseTransformer);
  t.true(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), [
    "To use the new TransformStream() constructor with a custom transformer, enable the transformstream_enable_standard_constructor feature flag.",
  ]);
  t.deepEqual(await writeThrough(stream, [new Uint8Array([1, 2, 3])]), [
    new Uint8Array([1, 2, 3]),
  ]);

  // Check with just "transformstream_enable_standard_constructor" compatibility flag
  // (should throw, with and without passed transformer)
  log.logs = [];
  compat = new Compatibility(undefined, [
    "transformstream_enable_standard_constructor",
  ]);
  plugin = new CorePlugin({ ...ctx, log, compat });
  globals = (await plugin.setup()).globals!;
  TransformStreamImpl = globals.TransformStream;

  await t.throws(() => new TransformStreamImpl(), {
    instanceOf: Error,
    message:
      "To use the new TransformStream() constructor, enable the streams_enable_constructors feature flag.",
  });
  await t.throws(() => new TransformStreamImpl(upperCaseTransformer), {
    instanceOf: Error,
    message:
      "To use the new TransformStream() constructor, enable the streams_enable_constructors feature flag.",
  });

  // Check with both flags
  log.logs = [];
  compat = new Compatibility(undefined, [
    "streams_enable_constructors",
    "transformstream_enable_standard_constructor",
  ]);
  plugin = new CorePlugin({ ...ctx, log, compat });
  globals = (await plugin.setup()).globals!;
  TransformStreamImpl = globals.TransformStream;

  stream = new TransformStreamImpl();
  t.false(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), []);
  t.deepEqual(await writeThrough(stream, ["a", "b", "c"]), ["a", "b", "c"]);

  stream = new TransformStreamImpl(upperCaseTransformer);
  t.false(stream instanceof IdentityTransformStream);
  t.deepEqual(log.logsAtLevel(LogLevel.WARN), []);
  t.deepEqual(await writeThrough(stream, ["a", "b", "c"]), ["A", "B", "C"]);
});
test("CorePlugin: setup: only includes stream controllers if compatibility flags enabled", async (t) => {
  // Check without any flags
  let plugin = new CorePlugin(ctx);
  let globals = (await plugin.setup()).globals!;
  t.is(typeof globals.ReadableByteStreamController, "undefined");
  t.is(typeof globals.ReadableStreamBYOBRequest, "undefined");
  t.is(typeof globals.ReadableStreamDefaultController, "undefined");
  t.is(typeof globals.WritableStreamDefaultController, "undefined");
  t.is(typeof globals.TransformStreamDefaultController, "undefined");

  // Check with just "streams_enable_constructors" compatibility flag
  let compat = new Compatibility(undefined, ["streams_enable_constructors"]);
  plugin = new CorePlugin({ ...ctx, compat });
  globals = (await plugin.setup()).globals!;
  t.is(typeof globals.ReadableByteStreamController, "function");
  t.is(typeof globals.ReadableStreamBYOBRequest, "function");
  t.is(typeof globals.ReadableStreamDefaultController, "function");
  t.is(typeof globals.WritableStreamDefaultController, "function");
  t.is(typeof globals.TransformStreamDefaultController, "undefined");

  // Check with just "transformstream_enable_standard_constructor" compatibility flag
  compat = new Compatibility(undefined, [
    "transformstream_enable_standard_constructor",
  ]);
  plugin = new CorePlugin({ ...ctx, compat });
  globals = (await plugin.setup()).globals!;
  t.is(typeof globals.ReadableByteStreamController, "undefined");
  t.is(typeof globals.ReadableStreamBYOBRequest, "undefined");
  t.is(typeof globals.ReadableStreamDefaultController, "undefined");
  t.is(typeof globals.WritableStreamDefaultController, "undefined");
  t.is(typeof globals.TransformStreamDefaultController, "undefined");

  // Check with both flags
  compat = new Compatibility(undefined, [
    "streams_enable_constructors",
    "transformstream_enable_standard_constructor",
  ]);
  plugin = new CorePlugin({ ...ctx, compat });
  globals = (await plugin.setup()).globals!;
  t.is(typeof globals.ReadableByteStreamController, "function");
  t.is(typeof globals.ReadableStreamBYOBRequest, "function");
  t.is(typeof globals.ReadableStreamDefaultController, "function");
  t.is(typeof globals.WritableStreamDefaultController, "function");
  t.is(typeof globals.TransformStreamDefaultController, "function");
});

// Test standards with basic-Miniflare and Node implementations
test("CorePlugin: setup: structuredClone: creates deep-copy of value", async (t) => {
  const plugin = new CorePlugin(ctx);
  const { globals } = await plugin.setup();
  assert(globals);

  const thing = {
    a: 1,
    b: new Date(),
    c: new Set([1, 2, 3]),
  };
  const copy = globals.structuredClone(thing);
  t.not(thing, copy);
  t.deepEqual(thing, copy);
});
test("CorePlugin: setup: (De)CompressionStream: (de)compresses data", async (t) => {
  const plugin = new CorePlugin(ctx);
  const { globals } = await plugin.setup();
  assert(globals);

  const CompressionStreamImpl: typeof CompressionStream =
    globals.CompressionStream;
  const DecompressionStreamImpl: typeof DecompressionStream =
    globals.DecompressionStream;

  const compressor = new CompressionStreamImpl("gzip");
  const decompressor = new DecompressionStreamImpl("gzip");
  const data = "".padStart(1024, "x");
  const writer = compressor.writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(utf8Encode(data));
  // noinspection ES6MissingAwait
  void writer.close();
  const decompressed = await text(
    // @ts-expect-error ReadableStream types are incompatible
    compressor.readable.pipeThrough(decompressor)
  );
  t.is(decompressed, data);
});

test("CorePlugin: processedModuleRules: processes rules includes default module rules", (t) => {
  const plugin = new CorePlugin(ctx, {
    modules: true,
    modulesRules: [
      { type: "Text", include: ["**/*.txt"], fallthrough: true },
      { type: "Text", include: ["**/*.text"], fallthrough: true },
    ],
  });
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 4);
  t.is(rules[0].type, "Text");
  t.true(rules[0].include.test("test.txt"));
  t.is(rules[1].type, "Text");
  t.true(rules[1].include.test("test.text"));
  t.is(rules[2].type, "ESModule");
  t.true(rules[2].include.test("test.mjs"));
  t.is(rules[3].type, "CommonJS");
  t.true(rules[3].include.test("test.js"));
  t.true(rules[3].include.test("test.cjs"));
});
test("CorePlugin: processedModuleRules: ignores rules with same type if no fallthrough", (t) => {
  const plugin = new CorePlugin(ctx, {
    modules: true,
    modulesRules: [{ type: "CommonJS", include: ["**/*.js"] }],
  });
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 2);
  t.is(rules[0].type, "CommonJS");
  t.true(rules[0].include.test("test.js"));
  t.is(rules[1].type, "ESModule");
  t.true(rules[1].include.test("test.mjs"));
});
test("CorePlugin: processedModuleRules: defaults to default module rules", (t) => {
  const plugin = new CorePlugin(ctx, { modules: true });
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 2);
  t.is(rules[0].type, "ESModule");
  t.true(rules[0].include.test("test.mjs"));
  t.is(rules[1].type, "CommonJS");
  t.true(rules[1].include.test("test.js"));
  t.true(rules[1].include.test("test.cjs"));
});
test("CorePlugin: processedModuleRules: empty if modules disabled", (t) => {
  const plugin = new CorePlugin(ctx);
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 0);
});

test("CorePlugin: setup: loads no script if none defined", async (t) => {
  const plugin = new CorePlugin(ctx);
  const result = await plugin.setup();
  t.deepEqual(result.watch, []);
  t.is(result.script, undefined);
});
test("CorePlugin: setup: loads script from string", async (t) => {
  const plugin = new CorePlugin(ctx, {
    script: "console.log('Hello!')",
  });
  const result = await plugin.setup();
  t.deepEqual(result.watch, undefined);
  t.deepEqual(result.script, {
    filePath: STRING_SCRIPT_PATH,
    code: "console.log('Hello!')",
  });
});
test("CorePlugin: setup: loads script from package.json in default location", async (t) => {
  const tmp = await useTmp(t);
  const defaultPackagePath = path.join(tmp, "package.json");
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log(42)");
  const plugin = new CorePlugin(
    { ...ctx, rootPath: tmp },
    { packagePath: true }
  );

  // Shouldn't throw if package.json doesn't exist...
  let result = await plugin.setup();
  // ...but should still watch package.json
  t.deepEqual(result.watch, [defaultPackagePath]);
  t.is(result.script, undefined);

  // Should still watch package.json if missing main field
  await fs.writeFile(defaultPackagePath, "{}");
  result = await plugin.setup();
  t.deepEqual(result.watch, [defaultPackagePath]);
  t.is(result.script, undefined);

  // Add main field and try setup again
  await fs.writeFile(defaultPackagePath, `{"main": "script.js"}`);
  result = await plugin.setup();
  t.deepEqual(result.watch, [defaultPackagePath, scriptPath]);
  t.deepEqual(result.script, { filePath: scriptPath, code: "console.log(42)" });
});
test("CorePlugin: setup: loads script from package.json in custom location", async (t) => {
  const tmp = await useTmp(t);

  const customPackagePath = path.join(tmp, "package.custom.json");
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log('custom')");

  const plugin = new CorePlugin(
    { ...ctx, rootPath: tmp },
    // Should resolve packagePath relative to rootPath
    { packagePath: "package.custom.json" }
  );
  // Should throw if package.json doesn't exist
  await t.throwsAsync(plugin.setup(), {
    code: "ENOENT",
    message: /package\.custom\.json/,
  });

  // Create file and try again
  await fs.writeFile(customPackagePath, `{"main": "script.js"}`);
  const result = await plugin.setup();
  t.deepEqual(result.watch, [customPackagePath, scriptPath]);
  t.deepEqual(result.script, {
    filePath: scriptPath,
    code: "console.log('custom')",
  });
});
test("CorePlugin: setup: loads module from package.json", async (t) => {
  const tmp = await useTmp(t);
  const packagePath = path.join(tmp, "package.json");
  await fs.writeFile(packagePath, `{"module": "script.mjs"}`);
  const scriptPath = path.join(tmp, "script.mjs");
  await fs.writeFile(scriptPath, "export default 42");
  const plugin = new CorePlugin(ctx, {
    modules: true,
    packagePath,
  });
  const result = await plugin.setup();
  t.deepEqual(result.watch, [packagePath, scriptPath]);
  t.deepEqual(result.script, {
    filePath: scriptPath,
    code: "export default 42",
  });
});
test("CorePlugin: setup: loads script from explicit path", async (t) => {
  const tmp = await useTmp(t);
  const packagePath = path.join(tmp, "package.json");
  await fs.writeFile(packagePath, `{"main": "bad.js"}`);
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log(42)");
  const plugin = new CorePlugin(
    { ...ctx, rootPath: tmp },
    {
      // Should resolve scriptPath relative to rootPath
      scriptPath: "script.js",
      packagePath,
    }
  );
  // packagePath should be ignored if an explicit scriptPath is set
  const result = await plugin.setup();
  t.deepEqual(result.watch, [scriptPath]); // No packagePath
  t.deepEqual(result.script, { filePath: scriptPath, code: "console.log(42)" });
});
