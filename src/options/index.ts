import { URL } from "url";
import { Log } from "../log";

export interface Options {
  // Unwatched Options
  sourceMap?: boolean;
  log?: boolean | Log;
  wranglerConfigPath?: string;
  wranglerConfigEnv?: string;
  watch?: boolean;
  port?: number;

  // Watched Options
  upstream?: string;
  crons?: string[];

  kvNamespaces?: string[];
  kvPersist?: boolean | string;

  cachePersist?: boolean | string;

  sitePath?: string;
  siteInclude?: string[];
  siteExclude?: string[];

  envPath?: string;
  bindings?: Record<string, any>;
}

export interface ProcessedOptions extends Options {
  upstreamUrl?: URL;
  validatedCrons?: string[];
  siteIncludeRegexps?: RegExp[];
  siteExcludeRegexps?: RegExp[];
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
    Upstream: options.upstreamUrl?.origin,
    Crons: options.validatedCrons,
    "KV Namespaces": options.kvNamespaces,
    "KV Persistence": options.kvPersist,
    "Cache Persistence": options.cachePersist,
    "Workers Site Path": options.sitePath,
    "Workers Site Include": options.siteIncludeRegexps,
    // Only include excludeRegexps if there are no includeRegexps
    "Workers Site Exclude": options.siteIncludeRegexps?.length
      ? undefined
      : options.siteExcludeRegexps,
    Bindings: options.bindings ? Object.keys(options.bindings) : undefined,
  };
  log.debug("Options:");
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && (!Array.isArray(value) || value?.length > 0)) {
      log.debug(`- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
  }
}
