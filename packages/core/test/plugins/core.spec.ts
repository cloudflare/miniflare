import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import { CorePlugin } from "@miniflare/core";
import { STRING_SCRIPT_PATH } from "@miniflare/shared";
import {
  NoOpLog,
  logPluginOptions,
  noop,
  parsePluginArgv,
  parsePluginWranglerConfig,
  triggerPromise,
  useServer,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";

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
    "--upstream",
    "https://github.com/mrbbot",
    "--watch",
    "--debug",
    "--verbose",
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
    upstream: "https://github.com/mrbbot",
    watch: true,
    debug: true,
    verbose: true,
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
test("CorePlugin: parses options from wrangler config", (t) => {
  const configDir = "config";
  let options = parsePluginWranglerConfig(
    CorePlugin,
    {
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
      miniflare: {
        upstream: "https://miniflare.dev",
        watch: true,
        debug: true,
        verbose: true,
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
    upstream: "https://miniflare.dev",
    watch: true,
    debug: true,
    verbose: true,
  });
  // Check build upload dir defaults to dist
  options = parsePluginWranglerConfig(
    CorePlugin,
    { build: { upload: { main: "script.js" } } },
    configDir
  );
  t.is(options.scriptPath, path.resolve(configDir, "dist", "script.js"));
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
    upstream: "https://miniflare.dev",
    watch: true,
    debug: true,
    verbose: true,
  });
  t.deepEqual(logs, [
    // script is OptionType.NONE so omitted
    "Script Path: script.js",
    "Wrangler Config Path: wrangler.custom.toml",
    "Wrangler Environment: dev",
    "Package Path: package.custom.json",
    "Modules: true",
    "Modules Rules: {Text: *.txt}, {Data: *.png, *.jpg}",
    "Upstream: https://miniflare.dev",
    "Watch: true",
    "Debug: true",
    "Verbose: true",
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
  const plugin = new CorePlugin(new NoOpLog());
  const { globals } = await plugin.setup();
  assert(globals);

  t.true(typeof globals.console === "object");

  t.true(typeof globals.setTimeout === "function");
  t.true(typeof globals.setInterval === "function");
  t.true(typeof globals.clearTimeout === "function");
  t.true(typeof globals.clearInterval === "function");

  t.true(typeof globals.atob === "function");
  t.true(typeof globals.btoa === "function");

  t.true(typeof globals.crypto === "object");
  t.true(typeof globals.CryptoKey === "function");
  t.true(typeof globals.TextDecoder === "function");
  t.true(typeof globals.TextEncoder === "function");

  t.is(globals.fetch, plugin.fetch);
  t.true(typeof globals.fetch === "function");
  t.true(typeof globals.Headers === "function");
  t.true(typeof globals.Request === "function");
  t.true(typeof globals.Response === "function");
  t.true(typeof globals.FormData === "function");
  t.true(typeof globals.Blob === "function");
  t.true(typeof globals.File === "function");
  t.true(typeof globals.URL === "function");
  t.true(typeof globals.URLSearchParams === "function");

  t.true(typeof globals.ByteLengthQueuingStrategy === "function");
  t.true(typeof globals.CountQueuingStrategy === "function");
  t.true(typeof globals.ReadableByteStreamController === "function");
  t.true(typeof globals.ReadableStream === "function");
  t.true(typeof globals.ReadableStreamBYOBReader === "function");
  t.true(typeof globals.ReadableStreamBYOBRequest === "function");
  t.true(typeof globals.ReadableStreamDefaultController === "function");
  t.true(typeof globals.ReadableStreamDefaultReader === "function");
  t.true(typeof globals.TransformStream === "function");
  t.true(typeof globals.TransformStreamDefaultController === "function");
  t.true(typeof globals.WritableStream === "function");
  t.true(typeof globals.WritableStreamDefaultController === "function");
  t.true(typeof globals.WritableStreamDefaultWriter === "function");

  t.true(typeof globals.Event === "function");
  t.true(typeof globals.EventTarget === "function");
  t.true(typeof globals.AbortController === "function");
  t.true(typeof globals.AbortSignal === "function");
  t.true(typeof globals.FetchEvent === "function");
  t.true(typeof globals.ScheduledEvent === "function");

  t.true(typeof globals.DOMException === "function");
  t.true(typeof globals.WorkerGlobalScope === "function");

  t.true(typeof globals.ArrayBuffer === "function");
  t.true(typeof globals.Atomics === "object");
  t.true(typeof globals.BigInt64Array === "function");
  t.true(typeof globals.BigUint64Array === "function");
  t.true(typeof globals.DataView === "function");
  t.true(typeof globals.Date === "function");
  t.true(typeof globals.Float32Array === "function");
  t.true(typeof globals.Float64Array === "function");
  t.true(typeof globals.Int8Array === "function");
  t.true(typeof globals.Int16Array === "function");
  t.true(typeof globals.Int32Array === "function");
  t.true(typeof globals.Map === "function");
  t.true(typeof globals.Set === "function");
  t.true(typeof globals.SharedArrayBuffer === "function");
  t.true(typeof globals.Uint8Array === "function");
  t.true(typeof globals.Uint8ClampedArray === "function");
  t.true(typeof globals.Uint16Array === "function");
  t.true(typeof globals.Uint32Array === "function");
  t.true(typeof globals.WeakMap === "function");
  t.true(typeof globals.WeakSet === "function");
  t.true(typeof globals.WebAssembly === "object");
});

test("CorePlugin: processedModuleRules: processes rules includes default module rules", (t) => {
  const plugin = new CorePlugin(new NoOpLog(), {
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
  const plugin = new CorePlugin(new NoOpLog(), {
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
  const plugin = new CorePlugin(new NoOpLog(), { modules: true });
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 2);
  t.is(rules[0].type, "ESModule");
  t.true(rules[0].include.test("test.mjs"));
  t.is(rules[1].type, "CommonJS");
  t.true(rules[1].include.test("test.js"));
  t.true(rules[1].include.test("test.cjs"));
});
test("CorePlugin: processedModuleRules: empty if modules disabled", (t) => {
  const plugin = new CorePlugin(new NoOpLog());
  const rules = plugin.processedModuleRules;
  t.is(rules.length, 0);
});

test("CorePlugin: fetch, reload, dispose: closes WebSockets", async (t) => {
  const plugin = new CorePlugin(new NoOpLog());
  let [eventTrigger, eventPromise] =
    triggerPromise<{ code: number; reason: string }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventTrigger);
  });
  let res = await plugin.fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  let webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  webSocket.accept();

  // Check reload closes WebSockets
  plugin.reload();
  let event = await eventPromise;
  t.is(event.code, 1012);
  t.is(event.reason, "Service Restart");

  // Check dispose closes WebSockets
  [eventTrigger, eventPromise] = triggerPromise();
  res = await plugin.fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  webSocket.accept();
  plugin.dispose();
  event = await eventPromise;
  t.is(event.code, 1012);
  t.is(event.reason, "Service Restart");
});
test("CorePlugin: fetch, reload: ignores already closed WebSockets", async (t) => {
  const plugin = new CorePlugin(new NoOpLog());
  const [eventTrigger, eventPromise] =
    triggerPromise<{ code: number; reason: string }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventTrigger);
  });
  const res = await plugin.fetch(server.ws, {
    headers: { upgrade: "websocket" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);
  webSocket.accept();
  webSocket.close(1000, "Test Closure");

  plugin.reload(); // Shouldn't throw
  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure"); // Not "Service Restart"
});

test("CorePlugin: setup: loads no script if none defined", async (t) => {
  const plugin = new CorePlugin(new NoOpLog());
  const result = await plugin.setup();
  t.deepEqual(result.watch, []);
  t.is(result.scripts, undefined);
  t.is(plugin.mainScriptPath, undefined);
});
test("CorePlugin: setup: loads script from string", async (t) => {
  const plugin = new CorePlugin(new NoOpLog(), {
    script: "console.log('Hello!')",
  });
  const result = await plugin.setup();
  t.deepEqual(result.watch, undefined);
  t.deepEqual(result.scripts, [
    { filePath: STRING_SCRIPT_PATH, code: "console.log('Hello!')" },
  ]);
  t.is(plugin.mainScriptPath, STRING_SCRIPT_PATH);
});
test("CorePlugin: setup: loads script from package.json in default location", async (t) => {
  const tmp = await useTmp(t);
  const defaultPackagePath = path.join(tmp, "package.json");
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log(42)");
  const plugin = new CorePlugin(
    new NoOpLog(),
    { packagePath: true },
    defaultPackagePath
  );

  // Shouldn't throw if package.json doesn't exist...
  let result = await plugin.setup();
  // ...but should still watch package.json
  t.deepEqual(result.watch, [defaultPackagePath]);
  t.is(result.scripts, undefined);
  t.is(plugin.mainScriptPath, undefined);

  // Should still watch package.json if missing main field
  await fs.writeFile(defaultPackagePath, "{}");
  result = await plugin.setup();
  t.deepEqual(result.watch, [defaultPackagePath]);
  t.is(result.scripts, undefined);
  t.is(plugin.mainScriptPath, undefined);

  // Add main field and try setup again
  await fs.writeFile(defaultPackagePath, `{"main": "script.js"}`);
  result = await plugin.setup();
  t.deepEqual(result.watch, [defaultPackagePath, scriptPath]);
  t.deepEqual(result.scripts, [
    { filePath: scriptPath, code: "console.log(42)" },
  ]);
  t.is(plugin.mainScriptPath, scriptPath);
});
test("CorePlugin: setup: loads script from package.json in custom location", async (t) => {
  const tmp = await useTmp(t);

  const defaultPackagePath = path.join(tmp, "package.default.json");
  const customPackagePath = path.join(tmp, "package.custom.json");
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log('custom')");

  const plugin = new CorePlugin(
    new NoOpLog(),
    { packagePath: customPackagePath },
    defaultPackagePath
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
  t.deepEqual(result.scripts, [
    { filePath: scriptPath, code: "console.log('custom')" },
  ]);
  t.is(plugin.mainScriptPath, scriptPath);
});
test("CorePlugin: setup: loads module from package.json", async (t) => {
  const tmp = await useTmp(t);
  const packagePath = path.join(tmp, "package.json");
  await fs.writeFile(packagePath, `{"module": "script.mjs"}`);
  const scriptPath = path.join(tmp, "script.mjs");
  await fs.writeFile(scriptPath, "export default 42");
  const plugin = new CorePlugin(new NoOpLog(), { modules: true, packagePath });
  const result = await plugin.setup();
  t.deepEqual(result.watch, [packagePath, scriptPath]);
  t.deepEqual(result.scripts, [
    { filePath: scriptPath, code: "export default 42" },
  ]);
  t.is(plugin.mainScriptPath, scriptPath);
});
test("CorePlugin: setup: loads script from explicit path", async (t) => {
  const tmp = await useTmp(t);
  const packagePath = path.join(tmp, "package.json");
  await fs.writeFile(packagePath, `{"main": "bad.js"}`);
  const scriptPath = path.join(tmp, "script.js");
  await fs.writeFile(scriptPath, "console.log(42)");
  const plugin = new CorePlugin(new NoOpLog(), { scriptPath, packagePath });
  // packagePath should be ignored if an explicit scriptPath is set
  const result = await plugin.setup();
  t.deepEqual(result.watch, [scriptPath]); // No packagePath
  t.deepEqual(result.scripts, [
    { filePath: scriptPath, code: "console.log(42)" },
  ]);
  t.is(plugin.mainScriptPath, scriptPath);
});
