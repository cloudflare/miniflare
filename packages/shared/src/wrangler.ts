import { CompatibilityFlag } from "./compat";
import { ModuleRuleType } from "./runner";

// See https://developers.cloudflare.com/workers/cli-wrangler/configuration#keys

export type UsageModel = "bundled" | "unbound";

export interface WranglerServiceConfig {
  /** @deprecated Use `binding` instead */
  name?: string;
  binding?: string;
  service: string;
  environment: string;
}

export type RouteType =
  | string
  | { pattern: string; zone_id?: string; zone_name?: string };

export interface WranglerEnvironmentConfig {
  name?: string; // inherited
  zone_id?: string; // inherited
  account_id?: string; // inherited
  workers_dev?: boolean; // inherited
  route?: RouteType; // NOT inherited
  routes?: RouteType[]; // NOT inherited
  webpack_config?: string; // inherited
  vars?: Record<string, any>; // NOT inherited
  kv_namespaces?: {
    binding: string;
    id?: string;
    preview_id?: string;
  }[]; // NOT inherited
  d1_databases?: {
    binding: string;
    database_name: string;
    database_id: string;
  }[]; // NOT inherited
  r2_buckets?: {
    binding: string;
    bucket_name?: string;
    preview_bucket_name?: string;
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
  queues?: {
    producers?: {
      binding: string;
      queue: string;
    }[];
    consumers?: {
      queue: string;
      batch_size?: number;
      batch_timeout?: number;
      message_retries?: number;
      dead_letter_queue?: string;
    }[];
  }; // (probably) NOT inherited
  triggers?: {
    crons?: string[];
  }; // inherited
  usage_model?: UsageModel; // inherited
  wasm_modules?: Record<string, string>; // inherited
  text_blobs?: Record<string, string>; // inherited
  data_blobs?: Record<string, string>; // inherited
  services?: WranglerServiceConfig[]; // (probably) NOT inherited
  /** @deprecated Use `services` instead */
  experimental_services?: WranglerServiceConfig[]; // (probably) NOT inherited
  miniflare?: {
    globals?: Record<string, any>;
    upstream?: string;
    watch?: boolean;
    build_watch_dirs?: string[];
    kv_persist?: boolean | string;
    d1_persist?: boolean | string;
    r2_persist?: boolean | string;
    cache?: boolean;
    cache_persist?: boolean | string;
    durable_objects_persist?: boolean | string;
    durable_objects_alarms?: boolean;
    env_path?: string;
    host?: string;
    port?: number;
    open?: boolean | string;
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
    live_reload?: boolean;
    update_check?: boolean;
    mounts?: Record<string, string>;
    route?: RouteType;
    routes?: RouteType[];
    global_async_io?: boolean;
    global_timers?: boolean;
    global_random?: boolean;
    actual_time?: boolean;
    inaccurate_cpu?: boolean;
  }; // inherited
}

export interface WranglerConfig extends WranglerEnvironmentConfig {
  type?: "javascript" | "webpack" | "rust"; // top level
  compatibility_date?: string;
  compatibility_flags?: CompatibilityFlag[];
  build?: {
    command?: string;
    cwd?: string;
    watch_dir?: string | string[];
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
