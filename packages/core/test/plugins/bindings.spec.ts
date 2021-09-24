import { BindingsPlugin } from "@miniflare/core";
import test from "ava";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "test:@miniflare/shared";

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

// TODO: complete
test("BindingsPlugin: setup: loads .env bindings from default location", (t) => {
  // ...and throws if noent
});
test("BindingsPlugin: setup: loads .env bindings from custom location", (t) => {
  // ...and throws if noent
});
test("BindingsPlugin: setup: includes custom bindings", (t) => {});
test("BindingsPlugin: setup: loads WebAssembly bindings", (t) => {});
