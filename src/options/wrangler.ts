import toml from "toml";
import { Options } from "./index";

interface WranglerEnvironmentConfig {
  name: string;
  zone_id?: string;
  account_id: string;
  workers_dev?: boolean;
  route?: string;
  routes?: string[];
  webpack_config?: string;
  vars?: Record<string, string>;
  kv_namespaces?: {
    binding: string;
    id: string;
    preview_id: string;
  }[];
  site?: {
    bucket: string;
    "entry-point"?: string;
    include?: string[];
    exclude?: string[];
  };
  triggers?: {
    crons?: string[];
  };
  miniflare?: {
    upstream?: string;
    kv_persist?: boolean | string;
    cache_persist?: boolean | string;
    env_path?: string;
    port?: number;
  };
}

interface WranglerConfig extends WranglerEnvironmentConfig {
  type: "javascript" | "webpack" | "rust";
  env?: Record<string, WranglerEnvironmentConfig>;
}

export function getWranglerOptions(input: string, env?: string): Options {
  // Parse wrangler config and select correct environment
  const config: WranglerConfig = toml.parse(input);
  if (env && config.env && env in config.env) {
    Object.assign(config, config.env[env]);
  }

  // Map wrangler keys to miniflare's
  return {
    bindings: config.vars,
    kvNamespaces: config.kv_namespaces?.map(({ binding }) => binding),
    sitePath: config.site?.bucket,
    siteInclude: config.site?.include,
    siteExclude: config.site?.exclude,
    crons: config.triggers?.crons,
    upstream: config.miniflare?.upstream,
    kvPersist: config.miniflare?.kv_persist,
    cachePersist: config.miniflare?.cache_persist,
    envPath: config.miniflare?.env_path,
    port: config.miniflare?.port,
  };
}
