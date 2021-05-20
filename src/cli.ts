#!/usr/bin/env node
import { networkInterfaces } from "os";
import dotenv from "dotenv";
import yargs from "yargs";
import { ConsoleLog } from "./log";
import { Options, stripUndefinedOptions } from "./options";
import { Miniflare } from "./index";

const defaultPort = 8787;

export interface ParsedArgv {
  script: string;
  options: Options;
}

function asStringArray(arr?: (string | number)[]): string[] | undefined {
  return arr?.map((value) => value.toString());
}

function parseBindings(arr?: string[]): Record<string, string> {
  return dotenv.parse(arr?.join("\n") ?? "");
}

function getAccessibleUrls(port: number): string[] {
  const urls: string[] = [];
  Object.values(networkInterfaces()).forEach((net) =>
    net?.forEach(({ family, address }) => {
      if (family === "IPv4") urls.push(`http://${address}:${port}`);
    })
  );
  return urls;
}

export default function parseArgv(raw: string[]): ParsedArgv {
  const argv = yargs
    .strict()
    .alias({ version: "v", help: "h" })
    .usage("Usage: $0 <script> [options]")
    .demandCommand(1, 1) // <script>
    .options({
      port: {
        type: "number",
        description: `HTTP server port (${defaultPort} by default)`,
        alias: "p",
      },
      debug: {
        type: "boolean",
        description: "Log debug messages",
        alias: "d",
      },
      "wrangler-config": {
        type: "string",
        description: "Path to wrangler.toml",
        alias: "c",
      },
      "wrangler-env": {
        type: "string",
        description: "Environment in wrangler.toml to use",
      },
      watch: {
        type: "boolean",
        description: "Watch files for changes",
        alias: "w",
      },
      upstream: {
        type: "string",
        description: "URL of upstream origin",
        alias: "u",
      },
      cron: {
        type: "array",
        description: "Cron pattern to trigger scheduled events with",
        alias: "t",
      },
      kv: {
        type: "array",
        description: "KV namespace to bind",
        alias: "k",
      },
      "kv-persist": {
        // type: "boolean" | "string",
        description: "Path to persist KV data to (omit path for default)",
      },
      "cache-persist": {
        // type: "boolean" | "string",
        description: "Path to persist cached data to (omit path for default)",
      },
      site: {
        type: "string",
        description: "Path to serve Workers Site files from",
        alias: "s",
      },
      "site-include": {
        type: "array",
        description: "Glob pattern of site files to serve",
      },
      "site-exclude": {
        type: "array",
        description: "Glob pattern of site files not to serve",
      },
      env: {
        type: "string",
        description: "Path to .env file",
        alias: "e",
      },
      binding: {
        type: "array",
        description: "Bind variable/secret (KEY=VALUE)",
        alias: "b",
      },
    })
    .parse(raw);

  const options = stripUndefinedOptions({
    sourceMap: true,
    log: new ConsoleLog(argv.debug),
    wranglerConfigPath: argv["wrangler-config"],
    wranglerConfigEnv: argv["wrangler-env"],
    watch: argv.watch,
    port: argv.port,
    upstream: argv.upstream,
    crons: asStringArray(argv.cron),
    kvNamespaces: asStringArray(argv.kv),
    kvPersist: argv["kv-persist"] as boolean | string | undefined,
    cachePersist: argv["cache-persist"] as boolean | string | undefined,
    sitePath: argv.site,
    siteInclude: asStringArray(argv["site-include"]),
    siteExclude: asStringArray(argv["site-exclude"]),
    envPath: argv.env,
    bindings: parseBindings(asStringArray(argv.binding)),
  });

  return {
    script: argv._[0] as string,
    options,
  };
}

if (module === require.main) {
  const { script, options } = parseArgv(process.argv.slice(2));
  const mf = new Miniflare(script, options);
  mf.getOptions().then(({ port = defaultPort }) => {
    mf.createServer().listen(port, () => {
      mf.log.info(`Listening on :${port}`);
      for (const url of getAccessibleUrls(port)) mf.log.info(`- ${url}`);
    });
  });
}
