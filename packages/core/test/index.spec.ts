import assert from "assert";
import fs from "fs/promises";
import { AddressInfo } from "net";
import path from "path";
import { setTimeout } from "timers/promises";
import { CachePlugin, CacheStorage } from "@miniflare/cache";
import {
  BindingsPlugin,
  BuildPlugin,
  CorePlugin,
  MiniflareCore,
  MiniflareCoreContext,
  MiniflareCoreError,
  PluginStorageFactory,
  ReloadEvent,
  Request,
  RequestInfo,
  RequestInit,
  _deepEqual,
  createFetchMock,
} from "@miniflare/core";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import { HTTPPlugin, createServer } from "@miniflare/http-server";
import { QueueBroker } from "@miniflare/queues";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  Context,
  LogLevel,
  NoOpLog,
  Options,
  Storage,
  TypedEventListener,
  getRequestContext,
} from "@miniflare/shared";
import {
  AsyncTestLog,
  LogEntry,
  MemoryStorageFactory,
  TestLog,
  TestPlugin,
  endsWith,
  startsWith,
  triggerPromise,
  useMiniflare,
  useMiniflareWithHandler,
  useServer,
  useTmp,
  utf8Decode,
  utf8Encode,
  waitForReload,
} from "@miniflare/shared-test";
import test, { Macro } from "ava";
import { Request as BaseRequest, File, FormData } from "undici";

const log = new NoOpLog();
// Only use this shared storage factory when the test doesn't care about storage
const storageFactory = new MemoryStorageFactory();
const scriptRunner = new VMScriptRunner();
const queueBroker = new QueueBroker();

const relative = (p: string) => path.relative("", p);

test("_deepEqual: checks top-level symbol property equality", (t) => {
  const a = Symbol("a");
  const b = Symbol("b");
  t.true(_deepEqual({ [a]: { a: 1 } }, { [a]: { a: 1 } }));
  t.false(_deepEqual({ [a]: { a: 1 } }, { [a]: { a: 2 } }));
  t.false(_deepEqual({ [a]: { a: 1 } }, { [b]: { a: 1 } }));
  t.false(_deepEqual({ [a]: { a: 1 } }, {}));
  t.false(_deepEqual({}, { [a]: { a: 1 } }));
});

test("MiniflareCore: always loads CorePlugin first", async (t) => {
  const log = new TestLog();
  const ctx: MiniflareCoreContext = {
    log,
    storageFactory,
    scriptRunner,
    queueBroker,
  };
  const expectedLogs: LogEntry[] = [
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [LogLevel.VERBOSE, "- beforeSetup(TestPlugin)"],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.VERBOSE, "- setup(CorePlugin)"],
    [LogLevel.VERBOSE, "- setup(TestPlugin)"],
    [LogLevel.INFO, "setup"],
  ];

  let mf = new MiniflareCore({ CorePlugin, TestPlugin }, ctx, {});
  let globalScope = await mf.getGlobalScope();
  t.is(globalScope.BigUint64Array, "overridden"); // see TestPlugin setup
  startsWith(t, log.logs, expectedLogs);
  log.logs = [];
  mf = new MiniflareCore({ TestPlugin, CorePlugin }, ctx, {});
  globalScope = await mf.getGlobalScope();
  t.is(globalScope.BigUint64Array, "overridden");
  startsWith(t, log.logs, expectedLogs);
});
test("MiniflareCore: always loads BindingsPlugin last", async (t) => {
  const log = new TestLog();
  const ctx: MiniflareCoreContext = {
    log,
    storageFactory,
    scriptRunner,
    queueBroker,
  };
  const expectedLogs: LogEntry[] = [
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "- Custom Globals: BigUint64Array"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [LogLevel.VERBOSE, "- beforeSetup(TestPlugin)"],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.VERBOSE, "- setup(CorePlugin)"],
    [LogLevel.VERBOSE, "- setup(TestPlugin)"],
    [LogLevel.INFO, "setup"],
    [LogLevel.VERBOSE, "- setup(BindingsPlugin)"],
  ];

  let mf = new MiniflareCore({ CorePlugin, TestPlugin, BindingsPlugin }, ctx, {
    globals: { BigUint64Array: "overridden again" },
  });
  let globalScope = await mf.getGlobalScope();
  t.is(globalScope.BigUint64Array, "overridden again");
  startsWith(t, log.logs, expectedLogs);
  log.logs = [];
  mf = new MiniflareCore({ CorePlugin, BindingsPlugin, TestPlugin }, ctx, {
    globals: { BigUint64Array: "overridden again" },
  });
  globalScope = await mf.getGlobalScope();
  t.is(globalScope.BigUint64Array, "overridden again");
  startsWith(t, log.logs, expectedLogs);
});

test("MiniflareCore: only passes plugins' options to plugin constructors", async (t) => {
  const mf = useMiniflare(
    { TestPlugin, BindingsPlugin },
    {
      // CorePlugin
      debug: true,
      // TestPlugin (only want these passed to TestPlugin constructor)
      booleanOption: true,
      stringOption: "test",
      // BindingsPlugin
      bindings: { KEY: "value" },
    }
  );
  const plugins = await mf.getPlugins();
  t.deepEqual(plugins.TestPlugin.constructedOptions, {
    booleanOption: true,
    stringOption: "test",
  });
});

test("MiniflareCore: #init: loads wrangler config from default location", async (t) => {
  const tmp = await useTmp(t);
  const defaultConfigPath = path.join(tmp, "wrangler.toml");

  const mf = useMiniflare(
    { BindingsPlugin },
    { rootPath: tmp, wranglerConfigPath: true }
  );
  // Shouldn't throw if file doesn't exist
  await mf.getGlobalScope();

  // Create file and try again
  await fs.writeFile(defaultConfigPath, '[vars]\nKEY = "value"');
  await mf.reload();
  const globalScope = await mf.getGlobalScope();
  t.is(globalScope.KEY, "value");
});
test("MiniflareCore: #init: loads wrangler config from custom location", async (t) => {
  const tmp = await useTmp(t);
  const defaultConfigPath = path.join(tmp, "wrangler.toml");
  const customConfigPath = path.join(tmp, "wrangler.custom.toml");
  await fs.writeFile(defaultConfigPath, '[vars]\nKEY = "default"');

  let mf = useMiniflare(
    { BindingsPlugin },
    {
      rootPath: tmp,
      // Should resolve wranglerConfigPath relative to rootPath
      wranglerConfigPath: "wrangler.custom.toml",
    }
  );
  // Should throw if file doesn't exist
  await t.throwsAsync(mf.getGlobalScope(), {
    code: "ENOENT",
    message: /wrangler\.custom\.toml/,
  });

  // Create file and try again
  await fs.writeFile(customConfigPath, '[vars]\nKEY = "custom"');
  // Have to create a new instance here as reload() awaits initPromise which was
  // rejected
  mf = useMiniflare(
    { BindingsPlugin },
    { rootPath: tmp, wranglerConfigPath: customConfigPath }
  );
  const globalScope = await mf.getGlobalScope();
  t.is(globalScope.KEY, "custom");
});
test("MiniflareCore: #init: loads different wrangler environment", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    `
    [miniflare]
    upstream = "http://localhost/"
    [env.production.miniflare]
    upstream = "https://miniflare.dev/"
    `
  );
  const mf = useMiniflare(
    { CorePlugin },
    { wranglerConfigPath, wranglerConfigEnv: "production" }
  );
  let plugins = await mf.getPlugins();
  t.is(plugins.CorePlugin.upstream, "https://miniflare.dev/");

  // Unset environment and check value is updated
  await mf.setOptions({ wranglerConfigEnv: undefined });
  plugins = await mf.getPlugins();
  t.is(plugins.CorePlugin.upstream, "http://localhost/");
});
test("MiniflareCore: #init: options override wrangler config", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    `[build]
command = "npm run build"
[miniflare]
upstream = "http://localhost/"`
  );
  const mf = useMiniflare(
    { CorePlugin, BuildPlugin },
    {
      wranglerConfigPath,
      buildCommand: undefined,
      upstream: "https://miniflare.dev/",
    }
  );
  const plugins = await mf.getPlugins();
  t.is(plugins.CorePlugin.upstream, "https://miniflare.dev/");
  t.is(plugins.BuildPlugin.buildCommand, undefined);
});
test("MiniflareCore: #init: gets watching option once", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  const config = (key: string, watch: boolean) => `
    [vars]
    KEY = "${key}"
    [miniflare]
    watch = ${watch}
    `;

  await fs.writeFile(wranglerConfigPath, config("1", true));
  const plugins = { CorePlugin, BindingsPlugin };
  const mf = useMiniflare(plugins, { wranglerConfigPath });
  let instances = await mf.getPlugins();
  t.true(instances.CorePlugin.watch);
  t.is((await instances.BindingsPlugin.setup()).bindings?.KEY, "1");

  // Disable watching in wrangler.toml
  let reloadPromise = waitForReload(mf);
  await fs.writeFile(wranglerConfigPath, config("2", false));
  await reloadPromise;
  instances = await mf.getPlugins();
  t.false(instances.CorePlugin.watch);
  t.is((await instances.BindingsPlugin.setup()).bindings?.KEY, "2");

  // Edit KEY again in wrangler.toml, file should still be watched even though
  // watching has been "disabled"
  reloadPromise = waitForReload(mf);
  await fs.writeFile(wranglerConfigPath, config("3", false));
  await reloadPromise;
  instances = await mf.getPlugins();
  t.false(instances.CorePlugin.watch);
  t.is((await instances.BindingsPlugin.setup()).bindings?.KEY, "3");
});
test("MiniflareCore: #init: creates all plugins on init", async (t) => {
  const log = new TestLog();
  const plugins = { TestPlugin1: TestPlugin, TestPlugin2: TestPlugin };
  const mf = useMiniflare(plugins, {}, log);
  await mf.getPlugins();

  const expectedLogs: LogEntry[] = [
    // Check all setup/beforeSetup hooks run, with all beforeSetup hooks running
    // before setups (INFOs come from TestPlugin)
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [LogLevel.VERBOSE, "- beforeSetup(TestPlugin1)"],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.VERBOSE, "- beforeSetup(TestPlugin2)"],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.VERBOSE, "- setup(CorePlugin)"],
    [LogLevel.VERBOSE, "- setup(TestPlugin1)"],
    [LogLevel.INFO, "setup"],
    [LogLevel.VERBOSE, "- setup(TestPlugin2)"],
    [LogLevel.INFO, "setup"],
  ];
  startsWith(t, log.logs, expectedLogs);
});
test("MiniflareCore: runs setup with namespaced plugin-specific storage", async (t) => {
  const log = new NoOpLog();
  const storageFactory = new MemoryStorageFactory();
  const mf = new MiniflareCore(
    { CorePlugin, TestPlugin },
    { log, storageFactory, scriptRunner, queueBroker }
  );
  const globalScope = await mf.getGlobalScope();
  const STORAGE: Storage = globalScope.STORAGE;
  await STORAGE.put("key", { value: utf8Encode("value") });

  // "test" is automatically derived from "TestPlugin"
  const storage = storageFactory.storages.get("test:STORAGE");
  t.not(storage, undefined);
  t.is(utf8Decode((await storage?.get("key"))?.value), "value");
});
test("MiniflareCore: #init: re-creates only plugins with changed options on reload", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin, BindingsPlugin },
    { numberOption: 1, bindings: { KEY: "value1" } },
    log
  );
  await mf.getPlugins();

  // Update option, check only TestPlugin disposed and re-created
  log.logs = [];
  await mf.setOptions({ numberOption: 2, bindings: { KEY: "value1" } });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- dispose(TestPlugin)",
    "- beforeSetup(TestPlugin)",
    "- setup(TestPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);

  // Update nested option, check only BindingsPlugin re-created
  log.logs = [];
  await mf.setOptions({ numberOption: 2, bindings: { KEY: "value2" } });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- dispose(BindingsPlugin)",
    "- setup(BindingsPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);

  // Update nothing, check just reloaded
  log.logs = [];
  await mf.setOptions({ numberOption: 2, bindings: { KEY: "value2" } });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);
});
test("MiniflareCore: #init: re-runs setup for script-providing plugins if any beforeSetup ran", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin, BindingsPlugin },
    { script: "//", numberOption: 1, bindings: { KEY: "value1" } },
    log
  );
  await mf.getPlugins();

  // Update TestPlugin options, CorePlugin setup should re-run as TestPlugin
  // has beforeSetup
  log.logs = [];
  await mf.setOptions({
    script: "//",
    numberOption: 2,
    bindings: { KEY: "value1" },
  });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- dispose(TestPlugin)",
    "- beforeSetup(TestPlugin)",
    "- setup(CorePlugin)",
    "- setup(TestPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "Running script...",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);

  // Update BindingsPlugin options, CorePlugin setup shouldN'T re-run as
  // BindingsPlugin doesn't have beforeSetup
  log.logs = [];
  await mf.setOptions({
    script: "//",
    numberOption: 2,
    bindings: { KEY: "value2" },
  });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- dispose(BindingsPlugin)",
    "- setup(BindingsPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "Running script...",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);
});
test("MiniflareCore: #init: re-creates all plugins if compatibility data, root path, or limits changed", async (t) => {
  const tmp1 = await useTmp(t);
  const tmp2 = await useTmp(t);

  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin, BindingsPlugin },
    { script: "//", rootPath: tmp1, compatibilityDate: "1970-01-01" },
    log
  );
  await mf.getPlugins();

  const expectedLogs = [
    "- dispose(TestPlugin)",
    "- beforeSetup(TestPlugin)",
    "- dispose(BindingsPlugin)",
    "- setup(CorePlugin)",
    "- setup(TestPlugin)",
    "- setup(BindingsPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "Running script...",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ];

  // Update compatibility date
  log.logs = [];
  await mf.setOptions({ script: "//", compatibilityDate: "2021-01-01" });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), expectedLogs);

  // Update compatibility flags
  log.logs = [];
  await mf.setOptions({
    script: "//",
    compatibilityDate: "2021-01-01",
    compatibilityFlags: ["fetch_refuses_unknown_protocols"],
  });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), expectedLogs);

  // Update root path
  log.logs = [];
  await mf.setOptions({ rootPath: tmp2 });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), expectedLogs);

  // Update global async I/O
  log.logs = [];
  await mf.setOptions({ globalAsyncIO: true });
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), expectedLogs);
});
test("MiniflareCore: #init: passes globalAsyncIO to all plugins", async (t) => {
  const mf = useMiniflare({ CachePlugin }, {});
  let caches: CacheStorage = (await mf.getGlobalScope()).caches;
  await t.throwsAsync(caches.default.match("http://localhost"), {
    instanceOf: Error,
    message: /^Some functionality, such as asynchronous I\/O/,
  });

  await mf.setOptions({ globalAsyncIO: true });
  caches = (await mf.getGlobalScope()).caches;
  await caches.default.match("http://localhost");
});
test("MiniflareCore: #init: throws if script required but not provided", async (t) => {
  const log = new NoOpLog();
  const ctx: MiniflareCoreContext = {
    log,
    storageFactory,
    scriptRunner,
    scriptRequired: true,
    queueBroker,
  };

  // Check throws if no script defined
  let mf = new MiniflareCore({ CorePlugin }, ctx);
  let error: Error | undefined = undefined;
  try {
    await mf.getPlugins();
  } catch (e: any) {
    error = e;
  }
  assert(error instanceof MiniflareCoreError);
  t.is(error!.code, "ERR_NO_SCRIPT");
  t.regex(error?.stack ?? "", /No script defined/);

  // Check build.upload.main is only suggested in modules mode
  // (cannot use notRegexp with t.throwsAsync hence catch)
  t.notRegex(error!.stack!, /build\.upload\.main/);
  mf = new MiniflareCore({ CorePlugin }, ctx, { modules: true });
  await t.throwsAsync(mf.getPlugins(), {
    instanceOf: MiniflareCoreError,
    code: "ERR_NO_SCRIPT",
    message: /build\.upload\.main/,
  });

  // Check doesn't throw if script defined
  mf = new MiniflareCore({ CorePlugin }, ctx, { script: "//" });
  await mf.getPlugins();

  // Check doesn't throw if scriptPath defined
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "//");
  mf = new MiniflareCore({ CorePlugin }, ctx, { scriptPath });
  await mf.getPlugins();
});
test("MiniflareCore: #init: logs options on init and change", async (t) => {
  // init, setOptions, reload or wrangler config change
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(wranglerConfigPath, "");

  const expectedLogs = (numberOption: number, modules?: boolean) => [
    "Initialising worker...",
    "Options:",
    `- Wrangler Config Path: ${relative(wranglerConfigPath)}`,
    ...(modules ? ["- Modules: true"] : []),
    "- Watch: true",
    `- Number Option: ${numberOption}`,
    "Enabled Compatibility Flags: <none>",
    "Reloading worker...",
  ];

  // Check options logged on init
  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin },
    { wranglerConfigPath, watch: true, numberOption: 1 },
    log
  );
  await mf.getPlugins();
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), [
    ...expectedLogs(1),
    `Watching ${relative(wranglerConfigPath)}...`,
  ]);

  // Check options logged on reload
  log.logs = [];
  await mf.reload();
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), expectedLogs(1));

  // Check options logged on setOptions
  log.logs = [];
  await mf.setOptions({ wranglerConfigPath, watch: true, numberOption: 2 });
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), expectedLogs(2));

  // Check options logged on wrangler config change
  log.logs = [];
  const [reloadTrigger, reloadPromise] = triggerPromise<unknown>();
  mf.addEventListener("reload", reloadTrigger, { once: true });
  await fs.writeFile(wranglerConfigPath, '[build.upload]\nformat = "modules"');
  await reloadPromise;
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), [
    `${relative(wranglerConfigPath)} changed...`,
    ...expectedLogs(2, true),
  ]);
});
test("MiniflareCore: #init: logs compatibility flags", async (t) => {
  // Check options logged on init
  const log = new TestLog();
  const mf = useMiniflare({}, {}, log);
  await mf.getPlugins();
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), [
    "Initialising worker...",
    "Options:",
    "Enabled Compatibility Flags: <none>",
    "Reloading worker...",
  ]);

  log.logs = [];
  await mf.setOptions({
    compatibilityFlags: ["formdata_parser_supports_files"],
  });
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), [
    "Initialising worker...",
    "Options:",
    "- Compatibility Flags: formdata_parser_supports_files",
    "Enabled Compatibility Flags:",
    "- formdata_parser_supports_files",
    "Reloading worker...",
  ]);
});

test("MiniflareCore: #reload: reloads worker on init", async (t) => {
  const log = new TestLog();
  const plugins = {
    CorePlugin,
    BindingsPlugin,
    TestPlugin1: TestPlugin,
    TestPlugin2: TestPlugin,
  };
  const mf = useMiniflare(
    plugins,
    {
      script: "export default { thing: 42 };",
      modules: true,
      bindings: { KEY: "value" },
    },
    log
  );

  const [reloadTrigger, reloadPromise] =
    triggerPromise<ReloadEvent<typeof plugins>>();
  mf.addEventListener("reload", reloadTrigger);
  await mf.getPlugins();

  const expectedLogs: LogEntry[] = [
    // Check all reload/beforeReload hooks run, with all beforeReload hooks
    // running before reloads (INFOs come from TestPlugin)
    [LogLevel.DEBUG, "Reloading worker..."],
    [LogLevel.VERBOSE, "- beforeReload(TestPlugin1)"],
    [LogLevel.INFO, "beforeReload"],
    [LogLevel.VERBOSE, "- beforeReload(TestPlugin2)"],
    [LogLevel.INFO, "beforeReload"],
    [LogLevel.VERBOSE, "- beforeReload(BindingsPlugin)"],
    [LogLevel.VERBOSE, "Running script..."],
    [LogLevel.VERBOSE, "- reload(TestPlugin1)"],
    [LogLevel.INFO, "reload"],
    [LogLevel.VERBOSE, "- reload(TestPlugin2)"],
    [LogLevel.INFO, "reload"],
    [LogLevel.VERBOSE, "- reload(BindingsPlugin)"],
    // Check bundle size logged too
    [LogLevel.INFO, "Worker reloaded! (29B)"],
  ];
  endsWith(t, log.logs, expectedLogs);

  // Check reload event dispatched
  const reloadEvent = await reloadPromise;
  const instances = await mf.getPlugins();
  t.is(instances, reloadEvent.plugins);
  t.true(reloadEvent.initial);

  // Check reload hook parameters
  const exports = instances.TestPlugin1.reloadModuleExports;
  t.deepEqual(exports?.default, { thing: 42 });
  t.is(instances.TestPlugin1.reloadBindings?.KEY, "value");
});
test("MiniflareCore: #reload: throws if multiple plugins return scripts", async (t) => {
  const plugins = { CorePlugin1: CorePlugin, CorePlugin2: CorePlugin };
  const mf = useMiniflare(plugins, {
    script: "export default { thing: 42 };",
    modules: true,
  });
  await t.throwsAsync(mf.getPlugins(), {
    instanceOf: TypeError,
    message: "Multiple plugins returned a script",
  });
});
test("MiniflareCore: #reload: only runs script if module exports needed when scriptRunForModuleExports set", async (t) => {
  const log = new NoOpLog();
  const storageFactory = new MemoryStorageFactory();
  const ctx: MiniflareCoreContext = {
    log,
    storageFactory,
    scriptRunner,
    scriptRunForModuleExports: true,
    queueBroker,
  };

  let calledback = false;
  const plugins = { CorePlugin, BindingsPlugin, DurableObjectsPlugin };
  const globals = { callback: () => (calledback = true) };
  const script = "callback(); export class TestObject {}";
  let mf = new MiniflareCore(plugins, ctx, {
    modules: true,
    script,
    globals,
  });
  await mf.getPlugins(); // Allow script to run
  t.false(calledback);

  mf = new MiniflareCore(plugins, ctx, {
    modules: true,
    script,
    globals,
    durableObjects: { TEST: "TestObject" },
  });
  await mf.getPlugins(); // Allow script to run
  t.true(calledback);
});
test("MiniflareCore: #reload: watches files", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  const test1Path = path.join(tmp, "test1.txt");
  const test2Path = path.join(tmp, "test2.txt");
  await fs.writeFile(wranglerConfigPath, '[vars]\nKEY = "value1"');
  await fs.writeFile(test1Path, "test1 value1");
  await fs.writeFile(test2Path, "test2 value1");

  const mf = useMiniflare(
    { BindingsPlugin, TestPlugin },
    {
      watch: true,
      wranglerConfigPath,
      beforeSetupWatch: [test1Path],
      setupWatch: [test2Path],
    },
    log
  );
  await mf.getPlugins();
  // Check final debug log is list of watched files
  const debugLogs = log.logsAtLevel(LogLevel.DEBUG);
  t.is(
    debugLogs[debugLogs.length - 1],
    `Watching ${relative(test1Path)}, ${relative(test2Path)}, ${relative(
      wranglerConfigPath
    )}...`
  );

  // Update file, check change detected
  log.logs = [];
  const reloadPromise = waitForReload(mf);
  await fs.writeFile(test1Path, "test1 value2");
  await reloadPromise;
  t.deepEqual(log.logs[0], [
    LogLevel.DEBUG,
    `${relative(test1Path)} changed...`,
  ]);
});
test("MiniflareCore: #reload: updates watched files", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const test1Path = path.join(tmp, "test1.txt");
  const test2Path = path.join(tmp, "test2.txt");
  await fs.writeFile(test1Path, "test1 value1");
  await fs.writeFile(test2Path, "test2 value1");

  const mf = useMiniflare(
    { TestPlugin },
    { watch: true, setupWatch: [test1Path] },
    log
  );
  await mf.getPlugins();

  // Update watched file path, check old file unwatched and new file watched
  log.logs = [];
  await mf.setOptions({ watch: true, setupWatch: [test2Path] });
  endsWith(t, log.logsAtLevel(LogLevel.DEBUG), [
    `Unwatching ${relative(test1Path)}...`,
    `Watching ${relative(test2Path)}...`,
  ]);

  // Update contents of previously-watched file, check for no logs
  log.logs = [];
  await fs.writeFile(test1Path, "test1 value2");
  await setTimeout(100); // Shouldn't reload here
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), []);

  // Update contents of newly-watched file, check for logs
  log.logs = [];
  const reloadPromise = waitForReload(mf);
  await fs.writeFile(test2Path, "test2 value2");
  await reloadPromise;
  t.is(log.logsAtLevel(LogLevel.DEBUG)[0], `${relative(test2Path)} changed...`);
});

test("MiniflareCore: #watcherCallback: re-inits on wrangler config change", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(wranglerConfigPath, '[vars]\nKEY = "value1"');

  const mf = useMiniflare(
    { BindingsPlugin },
    { watch: true, wranglerConfigPath },
    log
  );
  const plugins = await mf.getPlugins();
  const bindingsPlugin = plugins.BindingsPlugin;
  t.is((await bindingsPlugin.setup()).bindings?.KEY, "value1");

  // Update wrangler config, expecting BindingsPlugin to be re-created
  log.logs = [];
  const reloadPromise = waitForReload(mf);
  await fs.writeFile(wranglerConfigPath, '[vars]\nKEY = "value2"');
  await reloadPromise;
  t.not(plugins.BindingsPlugin, bindingsPlugin); // re-created
  t.is((await plugins.BindingsPlugin.setup()).bindings?.KEY, "value2");
  startsWith(t, log.logsAtLevel(LogLevel.DEBUG), [
    `${relative(wranglerConfigPath)} changed...`,
    "Initialising worker...", // re-init
  ]);
});
test("MiniflareCore: #watcherCallback: re-runs setup for plugins' changed paths", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const test1Path = path.join(tmp, "test1.txt");
  const test2Path = path.join(tmp, "test2.txt");
  await fs.writeFile(test1Path, "test1 value1");
  await fs.writeFile(test2Path, "test2 value1");

  const mf = useMiniflare(
    { TestPlugin },
    { watch: true, beforeSetupWatch: [test1Path], setupWatch: [test2Path] },
    log
  );
  await mf.getPlugins();

  // Update test1 contents, expecting TestPlugin beforeSetup to run
  log.logs = [];
  let reloadPromise = waitForReload(mf);
  await fs.writeFile(test1Path, "test1 value2");
  await reloadPromise;
  t.deepEqual(log.logsAtLevelOrBelow(LogLevel.DEBUG), [
    [LogLevel.DEBUG, `${relative(test1Path)} changed...`],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.DEBUG, "Reloading worker..."],
    [LogLevel.INFO, "beforeReload"],
    [LogLevel.INFO, "reload"],
  ]);

  // Update test2 contents, expecting TestPlugin setup to run
  log.logs = [];
  reloadPromise = waitForReload(mf);
  await fs.writeFile(test2Path, "test2 value2");
  await reloadPromise;
  t.deepEqual(log.logsAtLevelOrBelow(LogLevel.DEBUG), [
    [LogLevel.DEBUG, `${relative(test2Path)} changed...`],
    [LogLevel.INFO, "setup"],
    [LogLevel.DEBUG, "Reloading worker..."],
    [LogLevel.INFO, "beforeReload"],
    [LogLevel.INFO, "reload"],
  ]);
});
test("MiniflareCore: #watcherCallback: re-runs setup for script-providing plugins if any beforeSetup ran", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(testPath, "value1");
  await fs.writeFile(envPath, "KEY=value1");

  const mf = useMiniflare(
    { TestPlugin, BindingsPlugin },
    { watch: true, script: "//", beforeSetupWatch: [testPath], envPath },
    log
  );
  await mf.getPlugins();

  // Update TestPlugin watched path, CorePlugin setup should re-run as
  // TestPlugin has beforeSetup
  log.logs = [];
  let reloadPromise = waitForReload(mf);
  await fs.writeFile(testPath, "value2");
  await reloadPromise;
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- beforeSetup(TestPlugin)",
    "- setup(CorePlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "Running script...",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);

  // Update BindingsPlugin watched path, CorePlugin setup shouldN'T re-run as
  // BindingsPlugin doesn't have beforeSetup
  log.logs = [];
  reloadPromise = waitForReload(mf);
  await fs.writeFile(envPath, "KEY=value2");
  await reloadPromise;
  t.deepEqual(log.logsAtLevel(LogLevel.VERBOSE), [
    "- setup(BindingsPlugin)",
    "- beforeReload(TestPlugin)",
    "- beforeReload(BindingsPlugin)",
    "Running script...",
    "- reload(TestPlugin)",
    "- reload(BindingsPlugin)",
  ]);
});

test("MiniflareCore: reload: reloads worker", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "worker.js");
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    scriptPath,
    "export default { fetch: (req, env) => new Response(`1:${env.KEY}`) };"
  );
  await fs.writeFile(wranglerConfigPath, '[vars]\nKEY = "value1"');
  const mf = useMiniflare(
    { BindingsPlugin },
    { modules: true, scriptPath, wranglerConfigPath }
  );
  let res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "1:value1");

  // Change wrangler config and script, check not automatically reloaded
  // (note watch is disabled)
  await fs.writeFile(
    scriptPath,
    "export default { fetch: (req, env) => new Response(`2:${env.KEY}`) };"
  );
  await fs.writeFile(wranglerConfigPath, '[vars]\nKEY = "value2"');
  await setTimeout(100);
  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "1:value1");

  // Manually reload(), check config and script reloaded
  await mf.reload();
  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "2:value2");
});

test("MiniflareCore: dispatches reload events", async (t) => {
  const mf = useMiniflare({}, {});
  const plugins = await mf.getPlugins();

  let invocations = 0;
  const listener: TypedEventListener<
    ReloadEvent<{ CorePlugin: typeof CorePlugin }>
  > = (e) => {
    t.is(e.plugins, plugins);
    t.false(e.initial);
    invocations++;
  };
  mf.addEventListener("reload", listener);

  await mf.reload();
  t.is(invocations, 1);

  mf.dispatchEvent(new ReloadEvent("reload", { plugins, initial: false }));
  t.is(invocations, 2);

  mf.removeEventListener("reload", listener);
  await mf.reload();
  t.is(invocations, 2);
});

test("MiniflareCore: setOptions: updates options and reloads worker", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare({ TestPlugin }, { numberOption: 1 }, log);
  const plugins = await mf.getPlugins();
  const testPlugin = plugins.TestPlugin;
  t.is(testPlugin.numberOption, 1);

  // Update options and check worker reloaded
  log.logs = [];
  await mf.setOptions({ numberOption: 2 });
  t.not(plugins.TestPlugin, testPlugin); // re-created
  t.is(plugins.TestPlugin.numberOption, 2);

  const expectedLogs: LogEntry[] = [
    [LogLevel.DEBUG, "Initialising worker..."],
    [LogLevel.DEBUG, "Options:"],
    [LogLevel.DEBUG, "- Number Option: 2"],
    [LogLevel.DEBUG, "Enabled Compatibility Flags: <none>"],
    [LogLevel.VERBOSE, "- dispose(TestPlugin)"],
    [LogLevel.INFO, "dispose"],
    [LogLevel.VERBOSE, "- beforeSetup(TestPlugin)"],
    [LogLevel.INFO, "beforeSetup"],
    [LogLevel.VERBOSE, "- setup(TestPlugin)"],
    [LogLevel.INFO, "setup"],
    [LogLevel.DEBUG, "Reloading worker..."],
    [LogLevel.VERBOSE, "- beforeReload(TestPlugin)"],
    [LogLevel.INFO, "beforeReload"],
    [LogLevel.VERBOSE, "- reload(TestPlugin)"],
    [LogLevel.INFO, "reload"],
  ];
  t.deepEqual(log.logs, expectedLogs);
});
test("MiniflareCore: setOptions: builds on previous options", async (t) => {
  const mf = useMiniflare({ TestPlugin }, { numberOption: 1 });

  await mf.setOptions({ booleanOption: true });
  let plugins = await mf.getPlugins();
  t.is(plugins.TestPlugin.numberOption, 1);
  t.true(plugins.TestPlugin.booleanOption);

  await mf.setOptions({ numberOption: 2, stringOption: "test" });
  plugins = await mf.getPlugins();
  t.is(plugins.TestPlugin.numberOption, 2);
  t.is(plugins.TestPlugin.stringOption, "test");
  t.true(plugins.TestPlugin.booleanOption);
});

test("MiniflareCore: getPluginStorage: gets namespaced plugin-specific storage", async (t) => {
  const log = new NoOpLog();
  const storageFactory = new MemoryStorageFactory();
  const mf = new MiniflareCore(
    { CorePlugin },
    { log, storageFactory, scriptRunner, queueBroker }
  );
  const pluginStorageFactory = mf.getPluginStorage("CorePlugin");
  t.true(pluginStorageFactory instanceof PluginStorageFactory);
  const NS = pluginStorageFactory.storage("NS");
  await NS.put("key", { value: utf8Encode("value") });

  // "core" is automatically derived from "CorePlugin"
  const ns = storageFactory.storages.get("core:NS");
  t.not(ns, undefined);
  t.is(utf8Decode((await ns?.get("key"))?.value), "value");

  // Check plugin storages reused
  t.is(pluginStorageFactory, mf.getPluginStorage("CorePlugin"));
});

test("MiniflareCore: getPlugins: gets plugin instances", async (t) => {
  const mf = useMiniflare({}, { modules: true });
  const plugins = await mf.getPlugins();
  // noinspection SuspiciousTypeOfGuard
  t.true(plugins.CorePlugin instanceof CorePlugin);
  t.true(plugins.CorePlugin.modules);
});

test("MiniflareCore: getGlobalScope: gets mutable global scope", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    {
      script:
        'addEventListener("fetch", (e) => e.respondWith(new Response(`${KEY},${globalThis.KEY2 ?? ""}`)))',
      bindings: { KEY: "value1" },
    }
  );
  let res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "value1,");

  const globalScope = await mf.getGlobalScope();
  t.is(globalScope.KEY, "value1");

  // Mutate global scope and check change reflected in request
  // (probably shouldn't be doing this, use setOptions instead)
  globalScope.KEY = "value2"; // existing property
  globalScope.KEY2 = "test"; // new property
  res = await mf.dispatchFetch("http://localhost/");
  t.is(await res.text(), "value2,test");
});

test("MiniflareCore: getBindings: gets bindings", async (t) => {
  const mf = useMiniflare(
    { BindingsPlugin },
    { bindings: { KEY1: "value1" }, globals: { KEY2: "value2" } }
  );
  const bindings = await mf.getBindings();
  t.deepEqual(bindings, { KEY1: "value1" });
});

// Just testing dispatchFetch/dispatchScheduled parameter normalisation and
// pass-through here, more tests in standards/event.spec.ts
const dispatchFetchMacro: Macro<[input: RequestInfo, init?: RequestInit]> =
  async (t, input, init) => {
    const mf = useMiniflareWithHandler({}, {}, async (globals, req) => {
      const res = {
        instanceOf: req instanceof globals.Request,
        method: req.method,
        url: req.url,
        headers: [...req.headers],
        body: await req.text(),
      };
      return new globals.Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await mf.dispatchFetch(input, init);
    t.deepEqual(await res.json(), {
      instanceOf: true,
      method: "POST",
      url: "http://localhost/",
      headers: [["content-type", "text/plain;charset=UTF-8"]],
      body: "body",
    });
  };
dispatchFetchMacro.title = (providedTitle) =>
  `MiniflareCore: dispatchFetch: dispatches fetch event with ${providedTitle}`;
test("string", dispatchFetchMacro, "http://localhost/", {
  method: "POST",
  body: "body",
});
test(
  "Request",
  dispatchFetchMacro,
  new Request("http://localhost/", { method: "POST", body: "body" })
);
test(
  "BaseRequest",
  dispatchFetchMacro,
  new BaseRequest("http://localhost/", { method: "POST", body: "body" })
);
test("MiniflareCore: dispatchFetch: rewrites url to match upstream if different", async (t) => {
  const mf = useMiniflareWithHandler(
    {},
    { upstream: "https://miniflare.dev" },
    (globals, req) =>
      new globals.Response(`${req.url}:${req.headers.get("host")}`)
  );
  // Check url and host header are correct
  const init: RequestInit = { headers: { host: "localhost" } };
  let res = await mf.dispatchFetch("http://localhost/a", init);
  t.is(await res.text(), "https://miniflare.dev/a:localhost");

  // Check includes query string
  res = await mf.dispatchFetch("http://localhost/a?b=c", init);
  t.is(await res.text(), "https://miniflare.dev/a?b=c:localhost");

  // Check includes subpath
  await mf.setOptions({ upstream: "https://miniflare.dev/subpath/" });
  res = await mf.dispatchFetch("http://localhost/a", init);
  t.is(await res.text(), "https://miniflare.dev/subpath/a:localhost");
});
test("MiniflareCore: dispatchFetch: fetching incoming request responds with upstream", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const mf = useMiniflareWithHandler(
    {},
    { upstream: upstream.toString() },
    (globals, req) => globals.fetch(req)
  );
  // Host should be rewritten to match upstream
  const res = await mf.dispatchFetch("https://random.mf/");
  t.is(await res.text(), "upstream");
});
test("MiniflareCore: dispatchFetch: fetching incoming request with mocking enabled, but un-mocked upstream", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const mockAgent = createFetchMock();
  const mf = useMiniflareWithHandler(
    {},
    { upstream: upstream.toString(), fetchMock: mockAgent },
    (globals, req) => globals.fetch(req)
  );
  const res = await mf.dispatchFetch("https://random.mf/");
  t.is(await res.text(), "upstream");
  // Disabling net connect should throw as upstream hasn't been mocked
  mockAgent.disableNetConnect();
  try {
    await mf.dispatchFetch("https://random.mf/");
    t.fail();
  } catch (e: any) {
    t.is(e.cause.code, "UND_MOCK_ERR_MOCK_NOT_MATCHED");
  }
});
test("MiniflareCore: dispatchFetch: fetching incoming request with mocked upstream", async (t) => {
  const mockAgent = createFetchMock();
  mockAgent.disableNetConnect();
  const client = mockAgent.get("https://random.mf");
  client.intercept({ path: "/" }).reply(200, "Hello World!");
  const mf = useMiniflareWithHandler(
    {},
    { fetchMock: mockAgent },
    (globals, req) => globals.fetch(req)
  );
  const res = await mf.dispatchFetch("https://random.mf/");
  t.is(await res.text(), "Hello World!");
});
test("MiniflareCore: dispatchFetch: request gets immutable headers", async (t) => {
  const mf = useMiniflareWithHandler({}, {}, (globals, req) => {
    req.headers.delete("content-type");
    return new globals.Response("uh");
  });
  await t.throwsAsync(mf.dispatchFetch("http://localhost/"), {
    instanceOf: TypeError,
    message: "immutable",
  });
});
test("MiniflareCore: dispatchFetch: Request parse files in FormData as File objects only if compatibility flag enabled", async (t) => {
  let reqFormData: FormData;
  const options: Options<{ BindingsPlugin: typeof BindingsPlugin }> = {
    globals: { formDataCallback: (data: FormData) => (reqFormData = data) },
  };
  const handler = async (globals: Context, req: Request) => {
    globals.formDataCallback(await req.formData());
    return new globals.Response(null);
  };
  const formData = new FormData();
  formData.append("file", new File(["test"], "test.txt"));

  let mf = useMiniflareWithHandler({ BindingsPlugin }, options, handler);
  await mf.dispatchFetch("http://localhost", {
    method: "POST",
    body: formData,
  });
  t.is(reqFormData!.get("file"), "test");

  mf = useMiniflareWithHandler(
    { BindingsPlugin },
    { ...options, compatibilityFlags: ["formdata_parser_supports_files"] },
    handler
  );
  await mf.dispatchFetch("http://localhost", {
    method: "POST",
    body: formData,
  });
  const file = reqFormData!.get("file");
  assert(file instanceof File);
  t.is(await file.text(), "test");
  t.is(file.name, "test.txt");
});
test("MiniflareCore: dispatchFetch: creates new request context", async (t) => {
  const mf = useMiniflareWithHandler(
    { BindingsPlugin, CachePlugin },
    {
      globals: {
        assertSubrequests(expected: number) {
          t.is(getRequestContext()?.externalSubrequests, expected);
        },
      },
    },
    async (globals, req) => {
      globals.assertSubrequests(0);
      await globals.caches.default.match("http://localhost/");
      globals.assertSubrequests(1);

      const n = parseInt(new globals.URL(req.url).searchParams.get("n"));
      await Promise.all(
        Array.from(Array(n)).map(() =>
          globals.caches.default.match("http://localhost/")
        )
      );
      return new globals.Response("body");
    }
  );
  await t.throwsAsync(mf.dispatchFetch("http://localhost/?n=50"), {
    instanceOf: Error,
    message: /^Too many subrequests/,
  });
  const res = await mf.dispatchFetch("http://localhost/?n=1");
  t.is(await res.text(), "body");
});
test("MiniflareCore: dispatchFetch: increases request depth", async (t) => {
  const log = new AsyncTestLog();
  const depths: [request: number, pipeline: number][] = [];
  const mf = useMiniflare(
    { BindingsPlugin, HTTPPlugin },
    {
      bindings: {
        recordDepth() {
          const ctx = getRequestContext()!;
          depths.push([ctx.requestDepth, ctx.pipelineDepth]);
        },
      },
      modules: true,
      script: `export default {
        async fetch(request, env) {
          env.recordDepth();
          
          const url = new URL(request.url);
          const n = parseInt(url.searchParams.get("n") ?? "0");
          if (n === 0) return new Response("end");
          url.searchParams.set("n", n - 1);
          
          const res = await fetch(url, { headers: { Accept: "text/plain" }});
          return new Response(\`\${n},\${await res.text()}\`);
        }
      }`,
    },
    log
  );
  const server = await createServer(mf);
  t.teardown(() => server.close());
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });

  let res = await mf.dispatchFetch(`http://localhost:${port}/?n=3`);
  t.is(await res.text(), "3,2,1,end");
  t.deepEqual(depths, [
    [1, 1], // ?n=3
    [2, 1], // ?n=2
    [3, 1], // ?n=1
    [4, 1], // ?n=0
  ]);

  res = await mf.dispatchFetch(`http://localhost:${port}/?n=15`); // Shouldn't throw
  t.is(await res.text(), "15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,end");

  res = await mf.dispatchFetch(`http://localhost:${port}/?n=16`); // Should throw
  t.regex(
    await res.text(),
    /^16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,Error: Subrequest depth limit exceeded/
  );
  t.regex(
    (await log.nextAtLevel(LogLevel.ERROR)) ?? "",
    /^GET \/\?n=0: Error: Subrequest depth limit exceeded\./
  );
});

test("MiniflareCore: dispatchScheduled: dispatches scheduled event", async (t) => {
  const mf = useMiniflare(
    {},
    {
      script: `
      addEventListener("scheduled", (e) => {
        e.waitUntil(e.scheduledTime);
        e.waitUntil(e.cron);
      });
      `,
    }
  );
  const res = await mf.dispatchScheduled(1000, "30 * * * *");
  t.deepEqual(res, [1000, "30 * * * *"]);
});
test("MiniflareCore: dispatchScheduled: creates new request context", async (t) => {
  const mf = new MiniflareCore(
    { CorePlugin, BindingsPlugin, CachePlugin },
    { log, storageFactory, scriptRunner, queueBroker },
    {
      globals: {
        assertSubrequests(expected: number) {
          t.is(getRequestContext()?.externalSubrequests, expected);
        },
      },
      modules: true,
      script: `export default {
        async scheduled(controller) {
          assertSubrequests(0);
          await caches.default.match("http://localhost/");
          assertSubrequests(1);
          
          await Promise.all(
            Array.from(Array(controller.scheduledTime)).map(() =>
              caches.default.match("http://localhost/")
            )
          );
          return true;
        }
      }`,
    }
  );
  await t.throwsAsync(mf.dispatchScheduled(50), {
    instanceOf: Error,
    message: /^Too many subrequests/,
  });
  const waitUntil = await mf.dispatchScheduled(1);
  t.true(waitUntil[0]);
});

test("MiniflareCore: dispose: runs dispose for all plugins", async (t) => {
  const log = new TestLog();
  const mf = useMiniflare(
    { TestPlugin1: TestPlugin, TestPlugin2: TestPlugin },
    {},
    log
  );
  await mf.getPlugins();

  // Check plugin dispose hooks called on dispose
  log.logs = [];
  await mf.dispose();
  t.deepEqual(log.logs, [
    [LogLevel.VERBOSE, "- dispose(TestPlugin1)"],
    [LogLevel.INFO, "dispose"], // from TestPlugin
    [LogLevel.VERBOSE, "- dispose(TestPlugin2)"],
    [LogLevel.INFO, "dispose"], // from TestPlugin
  ]);
});
test("MiniflareCore: dispose: cleans up watcher", async (t) => {
  const tmp = await useTmp(t);
  const log = new TestLog();
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "1");

  const mf = useMiniflare(
    { TestPlugin },
    { watch: true, setupWatch: [testPath] },
    log
  );
  await mf.getPlugins();

  // Check file is being watched
  const reloadPromise = waitForReload(mf);
  log.logs = [];
  await fs.writeFile(testPath, "2");
  await reloadPromise;
  t.not(log.logsAtLevel(LogLevel.DEBUG).length, 0);

  // Dispose and check file stopped being watched
  await mf.dispose();
  log.logs = [];
  await fs.writeFile(testPath, "3");
  await setTimeout(100); // Shouldn't reload here
  t.is(log.logsAtLevel(LogLevel.DEBUG).length, 0);
});
test("MiniflareCore: dispatchFetch: awaits nested waitUntil", async (t) => {
  const mf = useMiniflare(
    {},
    {
      script: `
        async function waitAgain(ctx) {
          await scheduler.wait(100);
          ctx.waitUntil(scheduler.wait(100).then(() => 2));
          return 1;
        }
      
        export default {
          async fetch(req, env, ctx) {
            ctx.waitUntil(waitAgain(ctx));
            return new Response();
          },
          async scheduled(controller, env, ctx) {
            ctx.waitUntil(waitAgain(ctx));
            return 3;
          },
          async queue(batch, env, ctx) {
            ctx.waitUntil(waitAgain(ctx));
            return 4;
          }
        }
      `,
      modules: true,
    },
    log
  );

  const res = await mf.dispatchFetch("https://test");
  let waitUntil = await res.waitUntil();
  t.deepEqual(waitUntil, [1, 2]);

  waitUntil = await mf.dispatchScheduled();
  t.deepEqual(waitUntil, [1, 3, 2]);

  waitUntil = await mf.dispatchQueue({
    queue: "queue",
    messages: [],
    retryAll() {},
  });
  t.deepEqual(waitUntil, [1, 4, 2]);
});
