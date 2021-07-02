import test from "ava";
import { ConsoleLog } from "../src";
import parseArgv from "../src/cli";

test("parseArgv: parses complete argv", (t) => {
  const options = parseArgv([
    "script.js",
    "--host",
    "127.0.0.1",
    "--port",
    "1337",
    "--debug",
    "--wrangler-config",
    "wrangler.test.toml",
    "--wrangler-env",
    "production",
    "--modules",
    "--modules-rule",
    "ESModule=**/*.js",
    "--modules-rule",
    "Text=**/*.txt",
    "--build-command",
    "npm run build",
    "--build-base-path",
    "build",
    "--build-watch-path",
    "build_watch",
    "--watch",
    "--upstream",
    "https://mrbbot.dev",
    "--cron",
    "15 * * * *",
    "--cron",
    "45 * * * *",
    "--kv",
    "TEST_NAMESPACE1",
    "--kv",
    "TEST_NAMESPACE2",
    "--kv-persist",
    "--cache-persist",
    "--site",
    "public",
    "--site-include",
    "upload_dir",
    "--site-exclude",
    "ignore_dir",
    "--do",
    "OBJECT1=Object1",
    "--do",
    "OBJECT2=Object2",
    "--do-persist",
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
    sourceMap: true, // Always enabled in CLI
    scriptPath: "script.js",
    host: "127.0.0.1",
    port: 1337,
    log: new ConsoleLog(true), // Debug enabled
    wranglerConfigPath: "wrangler.test.toml",
    wranglerConfigEnv: "production",
    modules: true,
    modulesRules: [
      { type: "ESModule", include: ["**/*.js"], fallthrough: true },
      { type: "Text", include: ["**/*.txt"], fallthrough: true },
    ],
    buildCommand: "npm run build",
    buildBasePath: "build",
    buildWatchPath: "build_watch",
    watch: true,
    upstream: "https://mrbbot.dev",
    crons: ["15 * * * *", "45 * * * *"],
    kvNamespaces: ["TEST_NAMESPACE1", "TEST_NAMESPACE2"],
    kvPersist: true,
    cachePersist: true,
    sitePath: "public",
    siteInclude: ["upload_dir"],
    siteExclude: ["ignore_dir"],
    durableObjects: {
      OBJECT1: "Object1",
      OBJECT2: "Object2",
    },
    durableObjectsPersist: true,
    envPath: ".env.test",
    bindings: {
      KEY1: "value1",
      KEY2: "value2",
    },
    wasmBindings: {
      MODULE1: "module1.wasm",
      MODULE2: "module2.wasm",
    },
  });
});

test("parseArgv: parses aliased argv", (t) => {
  const options = parseArgv([
    "-dmw", // Debug, Modules, Watch
    "-H",
    "127.0.0.1",
    "-p",
    "1337",
    "-c",
    "wrangler.test.toml",
    "-u",
    "https://mrbbot.dev",
    "-t",
    "15 * * * *",
    "-t",
    "45 * * * *",
    "-k",
    "TEST_NAMESPACE1",
    "-k",
    "TEST_NAMESPACE2",
    "-s",
    "public",
    "-o",
    "OBJECT1=Object1",
    "-o",
    "OBJECT2=Object2",
    "-e",
    ".env.test",
    "-b",
    "KEY1=value1",
    "-b",
    "KEY2=value2",
  ]);
  t.deepEqual(options, {
    sourceMap: true, // Always enabled in CLI
    host: "127.0.0.1",
    port: 1337,
    log: new ConsoleLog(true), // Debug enabled
    wranglerConfigPath: "wrangler.test.toml",
    modules: true,
    watch: true,
    upstream: "https://mrbbot.dev",
    crons: ["15 * * * *", "45 * * * *"],
    kvNamespaces: ["TEST_NAMESPACE1", "TEST_NAMESPACE2"],
    sitePath: "public",
    durableObjects: {
      OBJECT1: "Object1",
      OBJECT2: "Object2",
    },
    envPath: ".env.test",
    bindings: {
      KEY1: "value1",
      KEY2: "value2",
    },
  });
});

test("parseArgv: parses empty argv", (t) => {
  const options = parseArgv([]);
  t.deepEqual(options, {
    sourceMap: true, // Always enabled in CLI
    log: new ConsoleLog(false), // Debug disabled
  });
});

test("parseArgv: parses persistence as boolean or string", (t) => {
  let options = parseArgv(["--kv-persist", "--cache-persist", "--do-persist"]);
  t.true(options.kvPersist);
  t.true(options.cachePersist);
  t.true(options.durableObjectsPersist);

  options = parseArgv([
    "--kv-persist",
    "./kv",
    "--cache-persist",
    "./cache",
    "--do-persist",
    "./do",
  ]);
  t.is(options.kvPersist, "./kv");
  t.is(options.cachePersist, "./cache");
  t.is(options.durableObjectsPersist, "./do");
});
