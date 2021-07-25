import { networkInterfaces } from "os";
import path from "path";
import { URL } from "url";
import { Log } from "../log";
import { ScriptBlueprint } from "../scripts";

export const stringScriptPath = "<script>";

export type ModuleRuleType =
  | "ESModule"
  | "CommonJS"
  | "Text"
  | "Data"
  | "CompiledWasm";

export interface ModuleRule {
  type: ModuleRuleType;
  include: string[];
  fallthrough?: boolean;
}

export interface ProcessedModuleRule {
  type: ModuleRuleType;
  include: RegExp[];
}

export const defaultModuleRules: ModuleRule[] = [
  { type: "ESModule", include: ["**/*.mjs"] },
  { type: "CommonJS", include: ["**/*.js", "**/*.cjs"] },
];

export interface DurableObjectOptions {
  [name: string]: string | { className: string; scriptPath?: string };
}

export interface ProcessedDurableObject {
  name: string;
  className: string;
  scriptPath: string;
}

export interface ProcessedHTTPSOptions {
  key?: string;
  cert?: string;
  ca?: string;
  pfx?: string;
  passphrase?: string;
}

export interface HTTPSOptions extends ProcessedHTTPSOptions {
  keyPath?: string;
  certPath?: string;
  caPath?: string;
  pfxPath?: string;
}

export interface Options {
  // Unwatched Options
  script?: string;
  sourceMap?: boolean;
  log?: boolean | Log;
  wranglerConfigPath?: string;
  wranglerConfigEnv?: string;
  packagePath?: string;
  watch?: boolean;
  host?: string;
  port?: number;
  https?: boolean | string | HTTPSOptions;
  disableUpdater?: boolean;

  // Watched Options
  scriptPath?: string;
  modules?: boolean;
  modulesRules?: ModuleRule[];
  buildCommand?: string;
  buildBasePath?: string;
  buildWatchPath?: string;

  upstream?: string;
  crons?: string[];

  kvNamespaces?: string[];
  kvPersist?: boolean | string;

  cachePersist?: boolean | string;
  disableCache?: boolean;

  sitePath?: string;
  siteInclude?: string[];
  siteExclude?: string[];

  durableObjects?: DurableObjectOptions;
  durableObjectsPersist?: boolean | string;

  envPath?: string;
  bindings?: Record<string, any>;
  wasmBindings?: Record<string, string>;
}

export interface ProcessedOptions extends Options {
  scripts?: Record<string, ScriptBlueprint>; // (absolute path -> script)
  processedModulesRules?: ProcessedModuleRule[];
  upstreamUrl?: URL;
  validatedCrons?: string[];
  siteIncludeRegexps?: RegExp[];
  siteExcludeRegexps?: RegExp[];
  processedDurableObjects?: ProcessedDurableObject[];
  processedHttps?: ProcessedHTTPSOptions;
}

export function stripUndefinedOptions(options: Options): Options {
  return Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .reduce((options, [key, value]) => {
      options[key as keyof Options] = value;
      return options;
    }, {} as Options);
}

export function logOptions(log: Log, options: ProcessedOptions): void {
  // Log final parsed options
  const entries = {
    "Build Command": options.buildCommand,
    // Make path undefined if relative path resolves to empty string (is cwd)
    "Build Base Path": options.buildBasePath
      ? path.relative("", options.buildBasePath) || undefined
      : undefined,
    Scripts: options.scripts
      ? Object.values(options.scripts).map((script) =>
          path.relative("", script.fileName)
        )
      : undefined,
    Modules: options.modules || undefined,
    "Modules Rules": options.modules
      ? options.processedModulesRules?.map(
          (rule) => `{${rule.type}: ${rule.include.join(", ")}}`
        )
      : undefined,
    Upstream: options.upstreamUrl?.origin,
    Crons: options.validatedCrons,
    "KV Namespaces": options.kvNamespaces,
    "KV Persistence": options.kvPersist,
    "Cache Persistence": options.cachePersist,
    "Disable Cache": options.disableCache,
    "Workers Site Path": options.sitePath,
    "Workers Site Include": options.siteIncludeRegexps,
    // Only include excludeRegexps if there are no includeRegexps
    "Workers Site Exclude": options.siteIncludeRegexps?.length
      ? undefined
      : options.siteExcludeRegexps,
    "Durable Objects": options.processedDurableObjects?.map(({ name }) => name),
    "Durable Objects Persistence": options.durableObjectsPersist,
    Bindings: options.bindings ? Object.keys(options.bindings) : undefined,
    HTTPS: !options.https
      ? undefined
      : typeof options.https === "object"
      ? "Custom"
      : options.https === true
      ? "Self-Signed"
      : `Self-Signed: ${options.https}`,
  };
  log.debug("Options:");
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && (!Array.isArray(value) || value?.length > 0)) {
      log.debug(`- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
  }
}

export function getAccessibleHosts(ipv4 = false): string[] {
  const hosts: string[] = [];
  Object.values(networkInterfaces()).forEach((net) =>
    net?.forEach(({ family, address }) => {
      if (!ipv4 || family === "IPv4") hosts.push(address);
    })
  );
  return hosts;
}
