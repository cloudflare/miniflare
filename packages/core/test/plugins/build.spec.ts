import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { BindingsPlugin, BuildError, BuildPlugin } from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  LogLevel,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
} from "@miniflare/shared";
import {
  TestLog,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
  useMiniflare,
  useTmp,
} from "@miniflare/shared-test";
import test from "ava";
import rimraf from "rimraf";
import which from "which";

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

const rimrafPromise = promisify(rimraf);

test("BuildPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(BuildPlugin, [
    "--build-command",
    "npm run build",
    "--build-base-path",
    "cwd",
    "--build-watch-path",
    "src1",
    "--build-watch-path",
    "src2",
  ]);
  t.deepEqual(options, {
    buildCommand: "npm run build",
    buildBasePath: "cwd",
    buildWatchPaths: ["src1", "src2"],
  });
  options = parsePluginArgv(BuildPlugin, [
    "-B",
    "yarn build",
    "--build-watch-path",
    "source",
  ]);
  t.deepEqual(options, {
    buildCommand: "yarn build",
    buildWatchPaths: ["source"],
  });
});
test("BuildPlugin: parses options from wrangler config", (t) => {
  let options = parsePluginWranglerConfig(BuildPlugin, {
    build: {
      command: "npm run build",
      cwd: "cwd",
      watch_dir: "source",
    },
    miniflare: {
      build_watch_dirs: ["source1", "source2"],
    },
  });
  t.deepEqual(options, {
    buildCommand: "npm run build",
    buildBasePath: "cwd",
    buildWatchPaths: ["source1", "source2", "source"],
  });
  // Check buildWatchPaths defaults to "src" if any command specified
  options = parsePluginWranglerConfig(BuildPlugin, {
    build: { command: "yarn build" },
  });
  t.deepEqual(options, {
    buildCommand: "yarn build",
    buildBasePath: undefined,
    buildWatchPaths: ["src"],
  });
  options = parsePluginWranglerConfig(BuildPlugin, { build: {} });
  t.deepEqual(options, {
    buildCommand: undefined,
    buildBasePath: undefined,
    buildWatchPaths: undefined,
  });
  // build.watch_dir should accept an array of strings
  options = parsePluginWranglerConfig(BuildPlugin, {
    build: {
      watch_dir: ["source", "source1"],
    },
    miniflare: {
      build_watch_dirs: ["source2", "source3"],
    },
  });
  t.like(options, {
    buildWatchPaths: ["source2", "source3", "source", "source1"],
  });
});
test("BuildPlugin: logs options", (t) => {
  const logs = logPluginOptions(BuildPlugin, {
    buildCommand: "npm run build",
    buildBasePath: "cwd",
    buildWatchPaths: ["src1", "src2"],
  });
  t.deepEqual(logs, [
    "Build Command: npm run build",
    "Build Base Path: cwd",
    "Build Watch Paths: src1, src2",
  ]);
});

test("BuildPlugin: beforeSetup: does nothing without build command", async (t) => {
  const plugin = new BuildPlugin(ctx);
  t.deepEqual(await plugin.beforeSetup(), {});
});
test("BuildPlugin: beforeSetup: runs build successfully", async (t) => {
  const tmp = await useTmp(t);
  const log = new TestLog();
  const plugin = new BuildPlugin(
    { ...ctx, log },
    {
      buildCommand: "echo test > test.txt",
      buildBasePath: tmp,
      buildWatchPaths: ["src1", "src2"],
    }
  );
  const result = await plugin.beforeSetup();
  t.deepEqual(result, {
    watch: [path.join(rootPath, "src1"), path.join(rootPath, "src2")],
  });
  t.deepEqual(log.logs, [[LogLevel.INFO, "Build succeeded"]]);
  const test = await fs.readFile(path.join(tmp, "test.txt"), "utf8");
  t.is(test.trim(), "test");
});
test("BuildPlugin: beforeSetup: builds in plugin context's rootPath", async (t) => {
  const tmp = await useTmp(t);
  let plugin = new BuildPlugin(
    // This will be set to the mounted directory when mounting workers
    { ...ctx, rootPath: tmp },
    { buildCommand: "echo test > test.txt" }
  );
  await plugin.beforeSetup();
  let test = await fs.readFile(path.join(tmp, "test.txt"), "utf8");
  t.is(test.trim(), "test");

  // Check resolves buildBasePath relative to rootPath
  const dir = path.join(tmp, "dir");
  await fs.mkdir(dir);
  plugin = new BuildPlugin(
    { ...ctx, rootPath: tmp },
    { buildCommand: "echo test > test.txt", buildBasePath: "dir" }
  );
  await plugin.beforeSetup();
  test = await fs.readFile(path.join(dir, "test.txt"), "utf8");
  t.is(test.trim(), "test");
});
test("BuildPlugin: beforeSetup: includes MINIFLARE environment variable", async (t) => {
  const tmp = await useTmp(t);
  const plugin = new BuildPlugin(ctx, {
    // Cross-platform get environment variable
    buildCommand: `"${process.execPath}" -e "console.log(JSON.stringify(process.env))" > env.json`,
    buildBasePath: tmp,
  });
  await plugin.beforeSetup();
  const env = JSON.parse(await fs.readFile(path.join(tmp, "env.json"), "utf8"));
  t.like(env, {
    NODE_ENV: "test", // Includes existing environment variables
    MINIFLARE: "1", // Includes MINIFLARE
  });
});
test("BuildPlugin: beforeSetup: throws with exit code if build fails", async (t) => {
  const plugin = new BuildPlugin(ctx, {
    buildCommand: "exit 42",
  });
  await t.throwsAsync(Promise.resolve(plugin.beforeSetup()), {
    instanceOf: BuildError,
    message: "Build failed with exit code 42",
    code: 42,
  });
});

const fixturesPath = path.join(__dirname, "..", "..", "..", "test", "fixtures");
const wranglerPath = path.join(fixturesPath, "wrangler");

const webpackPath = path.join(wranglerPath, "webpack");
const webpackSitePath = path.join(wranglerPath, "webpack-site");
const webpackSiteCustomPath = path.join(wranglerPath, "webpack-site-custom");
const rustPath = path.join(wranglerPath, "rust");

// These tests require wrangler and rust to be installed, so skip them if not installed
const wranglerInstalled = which.sync("wrangler", { nothrow: true });
const rustInstalled = which.sync("rustc", { nothrow: true });

const webpackTest = wranglerInstalled ? test : test.skip;
webpackTest(
  '_populateBuildConfig: builds type "webpack" projects',
  async (t) => {
    await rimrafPromise(path.join(webpackPath, "worker"));
    const mf = useMiniflare(
      { BuildPlugin },
      {
        wranglerConfigPath: path.join(webpackPath, "wrangler.toml"),
        wranglerConfigEnv: "dev",
      }
    );
    const plugins = await mf.getPlugins(); // Resolves once worker has been built
    // Check correct env used
    t.is(plugins.BuildPlugin.buildCommand, "wrangler build --env dev");
    // Check watch paths
    t.deepEqual(plugins.BuildPlugin.buildWatchPaths, ["src", "index.js"]);
    t.true(existsSync(path.join(webpackPath, "worker", "script.js")));

    const res = await mf.dispatchFetch("http://localhost:8787/");
    t.is(await res.text(), "webpack:http://localhost:8787/");
  }
);
webpackTest(
  '_populateBuildConfig: builds type "webpack" projects with Workers Site',
  async (t) => {
    const workerPath = path.join(webpackSitePath, "workers-site", "worker");
    await rimrafPromise(workerPath);
    const mf = useMiniflare(
      { BuildPlugin },
      { wranglerConfigPath: path.join(webpackSitePath, "wrangler.toml") }
    );
    await mf.getPlugins(); // Resolves once worker has been built
    t.true(existsSync(path.join(workerPath, "script.js")));
    const res = await mf.dispatchFetch("http://localhost:8787/");
    t.is(await res.text(), "webpack-site:http://localhost:8787/");
  }
);
webpackTest(
  '_populateBuildConfig: builds type "webpack" projects with Workers Site using custom entry point',
  async (t) => {
    const workerPath = path.join(webpackSiteCustomPath, "entry", "worker");
    await rimrafPromise(workerPath);
    const mf = useMiniflare(
      { BuildPlugin },
      { wranglerConfigPath: path.join(webpackSiteCustomPath, "wrangler.toml") }
    );
    await mf.getPlugins(); // Resolves once worker has been built
    t.true(existsSync(path.join(workerPath, "script.js")));
    const res = await mf.dispatchFetch("http://localhost:8787/");
    t.is(await res.text(), "webpack-site-custom:http://localhost:8787/");
  }
);

const rustTest = wranglerInstalled && rustInstalled ? test : test.skip;
rustTest('_populateBuildConfig: builds type "rust" projects', async (t) => {
  await rimrafPromise(path.join(rustPath, "worker", "generated"));
  const mf = useMiniflare(
    // BindingsPlugin required for wasm binding
    { BuildPlugin, BindingsPlugin },
    { wranglerConfigPath: path.join(rustPath, "wrangler.toml") }
  );
  await mf.getPlugins(); // Resolves once worker has been built
  t.true(existsSync(path.join(rustPath, "worker", "generated", "script.js")));
  t.true(existsSync(path.join(rustPath, "worker", "generated", "script.wasm")));

  const res = await mf.dispatchFetch("http://localhost:8787/");
  t.is(await res.text(), "rust:http://localhost:8787/");
});
