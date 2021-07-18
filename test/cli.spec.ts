import { promises as fs } from "fs";
import path from "path";
import test from "ava";
import { ConsoleLog } from "../src";
import parseArgv, { updateCheck } from "../src/cli";
import { HTTPSOptions } from "../src/options";
import { TestLog, useServer, useTmp } from "./helpers";

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
    "--package",
    "package.test.json",
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
    "https://miniflare.dev",
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
    "--https",
    "--disable-updater",
  ]);
  t.deepEqual(options, {
    sourceMap: true, // Always enabled in CLI
    scriptPath: "script.js",
    host: "127.0.0.1",
    port: 1337,
    log: new ConsoleLog(true), // Debug enabled
    wranglerConfigPath: "wrangler.test.toml",
    wranglerConfigEnv: "production",
    packagePath: "package.test.json",
    modules: true,
    modulesRules: [
      { type: "ESModule", include: ["**/*.js"], fallthrough: true },
      { type: "Text", include: ["**/*.txt"], fallthrough: true },
    ],
    buildCommand: "npm run build",
    buildBasePath: "build",
    buildWatchPath: "build_watch",
    watch: true,
    upstream: "https://miniflare.dev",
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
    https: true,
    disableUpdater: true,
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
    "https://miniflare.dev",
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
    upstream: "https://miniflare.dev",
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

test("parseArgv: assumes watch if build watch path set", (t) => {
  let options = parseArgv(["--build-watch-path", "src"]);
  t.true(options.watch);

  // Check doesn't override if watch explicitly disabled
  options = parseArgv(["--no-watch", "--build-watch-path", "src"]);
  t.false(options.watch);
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

test("parseArgv: parses https option as boolean or object", (t) => {
  // Check parses as boolean
  let options = parseArgv(["--https"]);
  t.true(options.https);

  // Check parses as object with all --https-* flags set
  options = parseArgv([
    "--https-key",
    "test_key",
    "--https-cert",
    "test_cert",
    "--https-ca",
    "test_ca",
    "--https-pfx",
    "test_pfx",
    "--https-passphrase",
    "test_passphrase",
  ]);
  t.deepEqual(options.https, {
    keyPath: "test_key",
    certPath: "test_cert",
    caPath: "test_ca",
    pfxPath: "test_pfx",
    passphrase: "test_passphrase",
  });

  // Check parses as object when any --https-* flag set
  const base: HTTPSOptions = {
    keyPath: undefined,
    certPath: undefined,
    caPath: undefined,
    pfxPath: undefined,
    passphrase: undefined,
  };
  options = parseArgv(["--https-key", "test_key"]);
  t.deepEqual(options.https, { ...base, keyPath: "test_key" });
  options = parseArgv(["--https-cert", "test_cert"]);
  t.deepEqual(options.https, { ...base, certPath: "test_cert" });
  options = parseArgv(["--https-ca", "test_ca"]);
  t.deepEqual(options.https, { ...base, caPath: "test_ca" });
  options = parseArgv(["--https-pfx", "test_pfx"]);
  t.deepEqual(options.https, { ...base, pfxPath: "test_pfx" });
  options = parseArgv(["--https-passphrase", "test_passphrase"]);
  t.deepEqual(options.https, { ...base, passphrase: "test_passphrase" });

  // Check parses as object when both --https and --https-* flags set
  options = parseArgv(["--https", "--https-key", "test_key"]);
  t.deepEqual(options.https, { ...base, keyPath: "test_key" });
});

test("updateCheck: logs if updated version available", async (t) => {
  t.plan(4);
  const tmp = await useTmp(t);
  const now = 172800000; // 2 days since unix epoch (must be > 1 day)
  const registry = await useServer(t, (req, res) => {
    t.is(req.url, "/miniflare/latest");
    res.end('{"version": "2.0.0"}');
  });
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    cachePath: tmp,
    now,
    registry: registry.http.toString(),
    log,
  });

  // Check update message logged
  t.is(log.warns.length, 1);
  t.regex(
    log.warns[0],
    /^Miniflare 2\.0\.0 is available, but you're using 1\.0\.0/
  );
  // Check last update check file written
  const lastCheck = await fs.readFile(path.join(tmp, "update-check"), "utf8");
  t.is(lastCheck, now.toString());
});
test("updateCheck: doesn't log if no updated version available", async (t) => {
  const tmp = await useTmp(t);
  const now = 172800000; // 2 days since unix epoch (must be > 1 day)
  const registry = await useServer(t, (req, res) => {
    res.end('{"version": "1.0.0"}');
  });
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    cachePath: tmp,
    now,
    registry: registry.http.toString(),
    log,
  });

  // Check no update message logged
  t.is(log.warns.length, 0);
  // Check last update check file still written
  const lastCheck = await fs.readFile(path.join(tmp, "update-check"), "utf8");
  t.is(lastCheck, now.toString());
});
test("updateCheck: skips if already checked in past day", async (t) => {
  const tmp = await useTmp(t);

  // Write last check time to file
  const lastCheckTime = 129600000; // 1.5 days since unix epoch
  const lastCheckFile = path.join(tmp, "update-check");
  await fs.writeFile(lastCheckFile, lastCheckTime.toString(), "utf8");

  const now = 172800000; // 2 days since unix epoch
  const registry = await useServer(t, () => t.fail());
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    cachePath: tmp,
    now,
    registry: registry.http.toString(),
    log,
  });
  // Check no update message logged
  t.is(log.warns.length, 0);
  // Check last update check file not updated
  const lastCheck = await fs.readFile(lastCheckFile, "utf8");
  t.is(lastCheck, lastCheckTime.toString());
});
