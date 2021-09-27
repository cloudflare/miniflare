import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BindingsPlugin } from "@miniflare/core";
import {
  NoOpLog,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.join(__dirname, "..", "..", "..", "test", "fixtures");
// add.wasm is a WebAssembly module with a single export "add" that adds
// its 2 integer parameters together and returns the result, it is from:
// https://webassembly.github.io/wabt/demo/wat2wasm/
const addModulePath = path.join(fixturesPath, "add.wasm");

test("BindingsPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(BindingsPlugin, [
    "--env",
    ".env.test",
    "--binding",
    "KEY1=value1",
    "--binding",
    "KEY2=value2",
    "--wasm",
    "MODULE1=module1.wasm",
    "--wasm",
    "MODULE2=module2.wasm",
  ]);
  t.deepEqual(options, {
    envPath: ".env.test",
    bindings: { KEY1: "value1", KEY2: "value2" },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
  });
  options = parsePluginArgv(BindingsPlugin, [
    "-e",
    ".env.test",
    "-b",
    "KEY1=value1",
    "-b",
    "KEY2=value2",
  ]);
  t.deepEqual(options, {
    envPath: ".env.test",
    bindings: { KEY1: "value1", KEY2: "value2" },
  });
});
test("BindingsPlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(BindingsPlugin, {
    vars: { KEY1: "value1", KEY2: "value2" },
    miniflare: {
      env_path: ".env.test",
      wasm_bindings: [
        { name: "MODULE1", path: "module1.wasm" },
        { name: "MODULE2", path: "module2.wasm" },
      ],
    },
  });
  t.deepEqual(options, {
    envPath: ".env.test",
    bindings: { KEY1: "value1", KEY2: "value2" },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
  });
});
test("BindingsPlugin: logs options", (t) => {
  const logs = logPluginOptions(BindingsPlugin, {
    envPath: true,
    bindings: { KEY1: "value1", KEY2: "value2" },
    wasmBindings: { MODULE1: "module1.wasm", MODULE2: "module2.wasm" },
  });
  t.deepEqual(logs, [
    "Env Path: .env",
    "Custom Bindings: KEY1, KEY2",
    "WASM Bindings: MODULE1, MODULE2",
  ]);
});

test("BindingsPlugin: setup: loads .env bindings from default location", async (t) => {
  const log = new NoOpLog();
  const tmp = await useTmp(t);
  const defaultEnvPath = path.join(tmp, ".env");

  let plugin = new BindingsPlugin(log, { envPath: true }, defaultEnvPath);
  // Shouldn't throw if file doesn't exist...
  let result = await plugin.setup();
  // ...but should still watch file
  t.deepEqual(result, { bindings: {}, watch: [defaultEnvPath] });

  // Create file and try setup again
  await fs.writeFile(defaultEnvPath, "KEY=value");
  result = await plugin.setup();
  t.deepEqual(result, { bindings: { KEY: "value" }, watch: [defaultEnvPath] });

  // Check default .env only loaded when envPath set to true
  plugin = new BindingsPlugin(log, {}, defaultEnvPath);
  result = await plugin.setup();
  t.deepEqual(result, { bindings: {}, watch: [] });
});
test("BindingsPlugin: setup: loads .env bindings from custom location", async (t) => {
  const log = new NoOpLog();
  const tmp = await useTmp(t);
  const defaultEnvPath = path.join(tmp, ".env.default");
  const customEnvPath = path.join(tmp, ".env");
  await fs.writeFile(defaultEnvPath, "KEY=default");

  const plugin = new BindingsPlugin(
    log,
    { envPath: customEnvPath },
    defaultEnvPath
  );
  // Should throw if file doesn't exist
  await t.throwsAsync(plugin.setup(), { code: "ENOENT" });

  // Create file and try setup again
  await fs.writeFile(customEnvPath, "KEY=custom");
  const result = await plugin.setup();
  t.deepEqual(result, { bindings: { KEY: "custom" }, watch: [customEnvPath] });
});
test("BindingsPlugin: setup: includes custom bindings", async (t) => {
  const log = new NoOpLog();
  const obj = { a: 1 };
  const plugin = new BindingsPlugin(log, { bindings: { obj } });
  const result = await plugin.setup();
  t.is(result.bindings?.obj, obj);
  t.deepEqual(result.watch, []);
});
test("BindingsPlugin: setup: loads WebAssembly bindings", async (t) => {
  const log = new NoOpLog();
  const plugin = new BindingsPlugin(log, {
    wasmBindings: { ADD: addModulePath },
  });
  const result = await plugin.setup();
  t.not(result.bindings?.ADD, undefined);
  assert(result.bindings?.ADD);
  const instance = new WebAssembly.Instance(result.bindings.ADD);
  assert(typeof instance.exports.add === "function");
  t.is(instance.exports.add(1, 2), 3);
});
test("BindingsPlugin: setup: loads bindings from all sources", async (t) => {
  const log = new NoOpLog();
  const tmp = await useTmp(t);
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, "A=a\nB=b\nC=c");
  const obj = { c: 3 };
  const plugin = new BindingsPlugin(log, {
    envPath,
    wasmBindings: {
      B: addModulePath,
      C: addModulePath,
    },
    bindings: { C: obj },
  });
  const result = await plugin.setup();
  t.is(result.bindings?.A, "a");
  assert(result.bindings?.B);
  const instance = new WebAssembly.Instance(result.bindings.B);
  assert(typeof instance.exports.add === "function");
  t.is(instance.exports.add(1, 2), 3);
  t.is(result.bindings.C, obj);
});
