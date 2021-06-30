import assert from "assert";
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
    durable_objects_persist?: boolean | string;
    env_path?: string;
    host?: string;
    port?: number;
    wasm_bindings?: { name: string; path: string }[];
  };
}

interface WranglerConfig extends WranglerEnvironmentConfig {
  type: "javascript" | "webpack" | "rust";
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

  // Auto-fill build configuration for "webpack" and "rust" worker types using
  // "wrangler build" if not already defined
  if (!config.build) {
    config.build = { upload: { dir: "" } };
    assert(config.build.upload); // TypeScript gets annoyed if this isn't here
    if (config.type === "webpack") {
      config.build.command = "wrangler build";
      config.build.upload.main = path.join("worker", "script.js");
    } else if (config.type === "rust") {
      const rustScript = path.join(__dirname, "rust.js");
      config.build.command = `wrangler build && node ${rustScript}`;
      config.build.upload.main = path.join("worker", "generated", "script.js");

      // Add wasm binding, script.wasm will be created by rustScript
      if (!config.miniflare) config.miniflare = {};
      if (!config.miniflare.wasm_bindings) config.miniflare.wasm_bindings = [];
      config.miniflare.wasm_bindings.push({
        name: "wasm",
        path: path.join("worker", "generated", "script.wasm"),
      });
    }
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
    durableObjectsPersist: config.miniflare?.durable_objects_persist,
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
