import { promises as fs } from "fs";
import { networkInterfaces } from "os";
import path from "path";
import fetch from "@mrbbot/node-fetch";
import envPaths from "env-paths";
import semverGt from "semver/functions/gt";
import yargs from "yargs";
import { ConsoleLog, Log } from "./log";
import {
  ModuleRule,
  ModuleRuleType,
  Options,
  stripUndefinedOptions,
} from "./options";
import { Miniflare } from "./index";

const defaultPort = 8787;

function asStringArray(arr?: (string | number)[]): string[] | undefined {
  return arr?.map((value) => value.toString());
}

function parseObject(arr?: string[]): Record<string, string> | undefined {
  return arr?.reduce((obj, entry) => {
    const equalsIndex = entry.indexOf("=");
    obj[entry.substring(0, equalsIndex)] = entry.substring(equalsIndex + 1);
    return obj;
  }, {} as Record<string, string>);
}

function parseModuleRules(arr?: string[]): ModuleRule[] | undefined {
  const obj = parseObject(arr);
  if (!obj) return undefined;
  return Object.entries(obj).map<ModuleRule>(([type, glob]) => ({
    type: type as ModuleRuleType,
    include: [glob],
    fallthrough: true,
  }));
}

function getAccessibleHosts(): string[] {
  const hosts: string[] = [];
  Object.values(networkInterfaces()).forEach((net) =>
    net?.forEach(({ family, address }) => {
      if (family === "IPv4") hosts.push(address);
    })
  );
  return hosts;
}

export default function parseArgv(raw: string[]): Options {
  const argv = yargs
    .strict()
    .alias({ version: "v", help: "h" })
    .usage("Usage: miniflare [script] [options]")
    .demandCommand(0, 1) // <script>
    .options({
      host: {
        type: "string",
        description: "HTTP server host to listen on (all by default)",
        alias: "H",
      },
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
      package: {
        type: "string",
        description: "Path to package.json",
      },
      modules: {
        type: "boolean",
        description: "Enable modules",
        alias: "m",
      },
      "modules-rule": {
        type: "array",
        description: "Modules import rule (TYPE=GLOB)",
      },
      "build-command": {
        type: "string",
        description: "Command to build project",
      },
      "build-base-path": {
        type: "string",
        description: "Working directory for build command",
      },
      "build-watch-path": {
        type: "string",
        description: "Directory to watch for rebuilding on changes",
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
      do: {
        type: "array",
        description: "Durable Object to bind (NAME=CLASS)",
        alias: "o",
      },
      "do-persist": {
        // type: "boolean" | "string",
        description:
          "Path to persist Durable Object data to (omit path for default)",
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
      wasm: {
        type: "array",
        description: "WASM module to bind (NAME=PATH)",
      },
      ["https"]: {
        // type: "boolean" | "string",
        description: "Enable self-signed HTTPS",
      },
      ["https-key"]: {
        type: "string",
        description: "Path to PEM SSL key",
      },
      ["https-cert"]: {
        type: "string",
        description: "Path to PEM SSL cert chain",
      },
      ["https-ca"]: {
        type: "string",
        description: "Path to SSL trusted CA certs",
      },
      ["https-pfx"]: {
        type: "string",
        description: "Path to PFX/PKCS12 SSL key/cert chain",
      },
      ["https-passphrase"]: {
        type: "string",
        description: "Passphrase to decrypt SSL files",
      },
      ["disable-updater"]: {
        type: "boolean",
        description: "Disable update checker",
      },
    })
    .parse(raw);

  return stripUndefinedOptions({
    scriptPath: argv._[0] as string,
    sourceMap: true,
    log: new ConsoleLog(argv.debug),
    wranglerConfigPath: argv["wrangler-config"],
    wranglerConfigEnv: argv["wrangler-env"],
    packagePath: argv.package,
    modules: argv.modules,
    modulesRules: parseModuleRules(asStringArray(argv["modules-rule"])),
    buildCommand: argv["build-command"],
    buildBasePath: argv["build-base-path"],
    buildWatchPath: argv["build-watch-path"],
    watch: argv.watch,
    host: argv.host,
    port: argv.port,
    upstream: argv.upstream,
    crons: asStringArray(argv.cron),
    kvNamespaces: asStringArray(argv.kv),
    kvPersist: argv["kv-persist"] as boolean | string | undefined,
    cachePersist: argv["cache-persist"] as boolean | string | undefined,
    sitePath: argv.site,
    siteInclude: asStringArray(argv["site-include"]),
    siteExclude: asStringArray(argv["site-exclude"]),
    durableObjects: parseObject(asStringArray(argv["do"])),
    durableObjectsPersist: argv["do-persist"] as boolean | string | undefined,
    envPath: argv.env,
    bindings: parseObject(asStringArray(argv.binding)),
    wasmBindings: parseObject(asStringArray(argv.wasm)),
    https:
      argv["https-key"] ||
      argv["https-cert"] ||
      argv["https-ca"] ||
      argv["https-pfx"] ||
      argv["https-passphrase"]
        ? {
            keyPath: argv["https-key"],
            certPath: argv["https-cert"],
            caPath: argv["https-ca"],
            pfxPath: argv["https-pfx"],
            passphrase: argv["https-passphrase"],
          }
        : (argv["https"] as boolean | string | undefined),
    disableUpdater: argv["disable-updater"],
  });
}

export async function updateCheck({
  pkg,
  cachePath,
  log,
  now = Date.now(),
  registry = "https://registry.npmjs.org/",
}: {
  pkg: { name: string; version: string };
  cachePath: string;
  log: Log;
  now?: number;
  registry?: string;
}): Promise<void> {
  // If checked within the past day, don't check again
  await fs.mkdir(cachePath, { recursive: true });
  const lastCheckFile = path.join(cachePath, "update-check");
  let lastCheck = 0;
  try {
    lastCheck = parseInt(await fs.readFile(lastCheckFile, "utf8"));
  } catch {}
  if (now - lastCheck < 86400000) return;

  // Get latest version's package.json from npm
  const res = await fetch(`${registry}${pkg.name}/latest`, {
    headers: { Accept: "application/json" },
  });
  const registryVersion = (await res.json()).version;
  if (!registryVersion) return;

  // Record new last check time
  await fs.writeFile(lastCheckFile, now.toString(), "utf8");

  // Log version if latest version is greater than the currently installed
  if (semverGt(registryVersion, pkg.version)) {
    log.warn(
      [
        `Miniflare ${registryVersion} is available,`,
        `but you're using ${pkg.version}.`,
        "Update for improved compatibility with Cloudflare Workers.",
      ].join(" ")
    );
  }
}

if (module === require.main) {
  // Suppress experimental modules warning
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, name, ctor) => {
    if (
      name === "ExperimentalWarning" &&
      warning.toString().startsWith("VM Modules")
    ) {
      return;
    }
    return originalEmitWarning(warning, name, ctor);
  };

  const options = parseArgv(process.argv.slice(2));
  const mf = new Miniflare(options);

  mf.getOptions()
    .then(async ({ host, port = defaultPort, processedHttps }) => {
      const secure = processedHttps !== undefined;
      (await mf.createServer(secure as any)).listen(port, host, async () => {
        const protocol = secure ? "https" : "http";
        mf.log.info(`Listening on ${host ?? ""}:${port}`);
        if (host) {
          mf.log.info(`- ${protocol}://${host}:${port}`);
        } else {
          for (const accessibleHost of getAccessibleHosts()) {
            mf.log.info(`- ${protocol}://${accessibleHost}:${port}`);
          }
        }

        // Check for updates, ignoring errors (it's not that important)
        if (options.disableUpdater) return;
        try {
          // Get currently installed package metadata
          const pkgFile = path.join(__dirname, "..", "..", "package.json");
          const pkg = JSON.parse(await fs.readFile(pkgFile, "utf8"));
          const cachePath = envPaths(pkg.name).cache;
          await updateCheck({ pkg, cachePath, log: mf.log });
        } catch {}
      });
    })
    .catch((err) => mf.log.error(err));
}
