#!/usr/bin/env node
import "./suppress";
import { ParseError, buildHelp, parseArgv } from "@miniflare/cli";
import { Options } from "@miniflare/shared";
import { red } from "kleur/colors";
import { Miniflare, PLUGINS } from "./api";

async function main() {
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

  // Autoload configuration files from default locations
  options.wranglerConfigPath ??= true;
  options.packagePath ??= true;
  options.envPath ??= true;
  // Assume --watch if --build-watch-path set
  if (options.buildWatchPaths?.length) options.watch = true;

  // TODO: warn if script path is src/... but dist/... exists

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

void main();
