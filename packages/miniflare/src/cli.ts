#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import type { Options } from "@miniflare/shared";
import { red } from "kleur/colors";
import type { MiniflareOptions } from "miniflare";
import open from "open";
import { updateCheck } from "./updater";

function suppressWarnings() {
  // Suppress experimental warnings
  const originalEmitWarning = process.emitWarning;
  // @ts-expect-error this works, but overloads are funky in typescript
  process.emitWarning = (warning, ctorTypeOptions, ctorCode, ctor) => {
    if (ctorTypeOptions === "ExperimentalWarning") {
      const warningString = warning.toString();
      if (
        warningString.startsWith("VM Modules") ||
        warningString.startsWith("stream/web") ||
        warningString.startsWith("buffer.Blob") ||
        warningString.startsWith("The Ed25519")
      ) {
        return;
      }
    }
    originalEmitWarning(warning, ctorTypeOptions, ctorCode, ctor);
  };
}

async function main() {
  // Need to import these after warnings have been suppressed
  const {
    ParseError,
    buildHelp,
    parseArgv,
  }: typeof import("@miniflare/cli-parser") = require("@miniflare/cli-parser");
  const {
    Log,
    LogLevel,
  }: typeof import("@miniflare/shared") = require("@miniflare/shared");
  const {
    Miniflare,
    PLUGINS,
  }: typeof import("miniflare") = require("miniflare");

  // Parse command line options
  let options: Options<typeof PLUGINS>;
  try {
    options = parseArgv(PLUGINS, process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    if (e.code === "ERR_VERSION") {
      console.error(e.message);
      return;
    }
    // MINIFLARE_EXEC_NAME will be set when calling from Wrangler
    const execName = process.env.MINIFLARE_EXEC_NAME ?? "miniflare";
    console.error(buildHelp(PLUGINS, execName));
    if (e.code === "ERR_HELP") return;
    console.error(`\n${red(e.message)}`);
    process.exitCode = 1;
    return;
  }

  // Autoload configuration files from default locations if none set
  options.wranglerConfigPath ??= true;
  options.packagePath ??= true;
  // Unlike wrangler.toml and package.json, the .env path can be customised
  // in wrangler.toml files, so it needs special treatment.
  options.envPathDefaultFallback = true;
  // Assume --watch if --build-watch-path or --live-reload set
  if (options.buildWatchPaths?.length || options.liveReload) {
    options.watch = true;
  }
  // Assume --modules if --durable-object set
  if (options.durableObjects && Object.keys(options.durableObjects).length) {
    options.modules = true;
  }

  // TODO: warn if script path is src/... but dist/... exists, or build command set, or type webpack/rust

  const logLevel = options?.verbose
    ? LogLevel.VERBOSE
    : options?.debug
    ? LogLevel.DEBUG
    : LogLevel.INFO;
  const mfOptions = options as MiniflareOptions;

  mfOptions.log = new Log(logLevel);
  mfOptions.sourceMap = true;
  // Catch and log unhandled rejections as opposed to crashing
  mfOptions.logUnhandledRejections = true;
  if (mfOptions.repl) {
    // Allow REPL to be started without a script
    mfOptions.scriptRequired = false;
    // Disable file watching in REPL
    mfOptions.watch = false;
    // Allow async I/O in REPL without request context
    mfOptions.globalAsyncIO = true;
    mfOptions.globalTimers = true;
    mfOptions.globalRandom = true;
  }

  const mf = new Miniflare(mfOptions);
  try {
    if (mfOptions.repl) {
      // Start Miniflare REPL
      await mf.startREPL();
    } else {
      // Start Miniflare development server
      await mf.startServer();
      await mf.startScheduler();
    }
  } catch (e: any) {
    mf.log.error(e);
    process.exitCode = 1;
    // Unmount any mounted workers
    await mf.dispose();
    return;
  }

  // Open browser if requested
  const openURL = await mf.getOpenURL();
  try {
    if (openURL) await open(openURL);
  } catch (e: any) {
    mf.log.warn("Unable to open browser: " + e.stack);
  }

  // TODO: check how this works with next tag
  const plugins = await mf.getPlugins();
  // Check for updates, ignoring errors (it's not that important)
  // Explicitly checking === false as undefined (default) should be true
  if (plugins.CorePlugin.updateCheck === false) return;
  try {
    // Get currently installed package metadata
    const pkgFile = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
    const cacheDir = path.resolve("node_modules", ".mf");
    await fs.mkdir(cacheDir, { recursive: true });
    const lastCheckFile = path.join(cacheDir, "update-check");
    await updateCheck({ pkg, lastCheckFile, log: mf.log });
  } catch (e: any) {
    mf.log.debug("Unable to check for updates: " + e.stack);
  }
}

suppressWarnings();
void main();
