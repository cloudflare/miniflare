import { ModuleRuleType } from "./runner";

// See https://developers.cloudflare.com/workers/cli-wrangler/configuration#keys

export interface WranglerEnvironmentConfig {
  name?: string; // inherited
  zone_id?: string; // inherited
  account_id?: string; // inherited
  workers_dev?: boolean; // inherited
  route?: string; // NOT inherited
  routes?: string[]; // NOT inherited
  webpack_config?: string; // inherited
  vars?: Record<string, any>; // NOT inherited
  kv_namespaces?: {
    binding: string;
    id?: string;
    preview_id?: string;
  }[]; // NOT inherited
  site?: {
    bucket: string;
    "entry-point"?: string;
    include?: string[];
    exclude?: string[];
  }; // inherited
  durable_objects?: {
    bindings?: {
      name: string;
      class_name: string;
      script_name?: string;
    }[];
  }; // (probably) NOT inherited
  triggers?: {
    crons?: string[];
  }; // inherited
  usage_model?: "bundled" | "unbound"; // inherited
  wasm_modules?: Record<string, string>; // (probably) inherited
  miniflare?: {
    globals?: Record<string, any>;
    upstream?: string;
    watch?: boolean;
    kv_persist?: boolean | string;
    cache?: boolean;
    cache_persist?: boolean | string;
    durable_objects_persist?: boolean | string;
    env_path?: string;
    host?: string;
    port?: number;
    cf_fetch?: boolean | string;
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
    update_check?: boolean;
  }; // inherited
}

export interface WranglerConfig extends WranglerEnvironmentConfig {
  type?: "javascript" | "webpack" | "rust"; // top level
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
  }; // top level
  env?: Record<string, WranglerEnvironmentConfig>;
}
