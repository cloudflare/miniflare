import path from "path";
import toml from "toml";
import { DurableObjectOptions, ModuleRuleType, Options } from "./index";

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
  durable_objects?: {
    bindings?: {
      name: string;
      class_name: string;
      script_name?: string;
    }[];
  };
  triggers?: {
    crons?: string[];
  };
  build?: {
    command?: string;
    cwd?: string;
    watch_dir?: string;
    upload?: {
      format?: "service-worker" | "modules";
      dir?: string;
      main?: string;
      rules?: {
        type: ModuleRuleType;
        globs: string[];
        fallthrough?: boolean;
      }[];
    };
  };
  miniflare?: {
    upstream?: string;
    kv_persist?: boolean | string;
    cache_persist?: boolean | string;
    durable_object_persist?: boolean | string;
    env_path?: string;
    host?: string;
    port?: number;
    wasm_bindings?: { name: string; path: string }[];
  };
}

interface WranglerConfig extends WranglerEnvironmentConfig {
  type: "javascript" | "webpack" | "rust"; // TODO: support these (with default `build` configs)
  usage_model?: "bundled" | "unbound";
  env?: Record<string, WranglerEnvironmentConfig>;
}

export function getWranglerOptions(
  input: string,
  inputDir: string,
  env?: string
): Options {
  // Parse wrangler config and select correct environment
  const config: WranglerConfig = toml.parse(input);
  if (env && config.env && env in config.env) {
    Object.assign(config, config.env[env]);
  }

  // Map wrangler keys to miniflare's
  return {
    scriptPath: config.build?.upload?.main
      ? path.resolve(
          inputDir,
          config.build?.upload?.dir ?? "dist",
          config.build.upload.main
        )
      : undefined,
    modules:
      config.build?.upload?.format === "modules" ||
      (config.durable_objects?.bindings?.length ?? 0) !== 0,
    modulesRules: config.build?.upload?.rules?.map(
      ({ type, globs, fallthrough }) => ({
        type,
        include: globs,
        fallthrough,
      })
    ),
    bindings: config.vars,
    kvNamespaces: config.kv_namespaces?.map(({ binding }) => binding),
    sitePath: config.site?.bucket
      ? path.resolve(inputDir, config.site?.bucket)
      : undefined,
    siteInclude: config.site?.include,
    siteExclude: config.site?.exclude,
    durableObjects: config.durable_objects?.bindings?.reduce(
      (objects, { name, class_name, script_name }) => {
        objects[name] = { className: class_name, scriptPath: script_name };
        return objects;
      },
      {} as DurableObjectOptions
    ),
    crons: config.triggers?.crons,
    buildCommand: config.build?.command,
    buildBasePath: config.build?.cwd,
    buildWatchPath: config.build?.watch_dir ?? (config.build?.command && "src"),
    upstream: config.miniflare?.upstream,
    kvPersist: config.miniflare?.kv_persist,
    cachePersist: config.miniflare?.cache_persist,
    durableObjectPersist: config.miniflare?.durable_object_persist,
    envPath: config.miniflare?.env_path,
    host: config.miniflare?.host,
    port: config.miniflare?.port,
    wasmBindings: config.miniflare?.wasm_bindings?.reduce(
      (bindings, { name, path }) => {
        bindings[name] = path;
        return bindings;
      },
      {} as Record<string, string>
    ),
  };
}
