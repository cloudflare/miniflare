#!/usr/bin/env node
import type { Options } from "@miniflare/shared";
import { red } from "kleur/colors";

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
        warningString.startsWith("buffer.Blob")
      ) {
        return;
      }
    }
    originalEmitWarning(warning, ctorTypeOptions, ctorCode, ctor);
  };
}

async function main() {
  // Need to import these after warnings have been suppressed
  const [{ ParseError, buildHelp, parseArgv }, { Miniflare, PLUGINS }] =
    await Promise.all([import("@miniflare/cli"), import("miniflare")]);

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
  options.envPath ??= true;
  // Assume --watch if --build-watch-path set
  if (options.buildWatchPaths?.length) options.watch = true;

  // TODO: warn if script path is src/... but dist/... exists, or build command set, or type webpack/rust

  const mf = new Miniflare(options);
  try {
    // Start Miniflare development server
    await mf.startServer();
    await mf.startScheduler();
  } catch (e: any) {
    mf.log.error(e);
    process.exitCode = 1;
    return;
  }

  // TODO: update checker
}

suppressWarnings();
void main();
