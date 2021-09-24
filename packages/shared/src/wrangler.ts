import { ModuleRuleType } from "./runner";

export interface WranglerEnvironmentConfig {
  name?: string;
  zone_id?: string;
  account_id?: string;
  workers_dev?: boolean;
  route?: string;
  routes?: string[];
  webpack_config?: string;
  vars?: Record<string, string>;
  kv_namespaces?: {
    binding: string;
    id?: string;
    preview_id?: string;
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
    watch?: boolean;
    debug?: boolean;
    verbose?: boolean;
    kv_persist?: boolean | string;
    cache_persist?: boolean | string;
    disable_cache?: boolean;
    durable_objects_persist?: boolean | string;
    env_path?: string;
    host?: string;
    port?: number;
    https?:
      | boolean
      | string
      | {
          key?: string;
          cert?: string;
          ca?: string;
          pfx?: string;
          passphrase?: string;
        };
    wasm_bindings?: { name: string; path: string }[];
    disable_updater?: boolean;
  };
}

export interface WranglerConfig extends WranglerEnvironmentConfig {
  type?: "javascript" | "webpack" | "rust";
  usage_model?: "bundled" | "unbound";
  env?: Record<string, WranglerEnvironmentConfig>;
}
