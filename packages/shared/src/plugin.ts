import { MockAgent } from "undici";
import { Compatibility } from "./compat";
import { titleCase } from "./data";
import { Log } from "./log";
import { QueueBroker, QueueEventDispatcher } from "./queues";
import { ScriptBlueprint } from "./runner";
import { StorageFactory } from "./storage";
import { Awaitable } from "./sync";
import { UsageModel, WranglerConfig } from "./wrangler";

export type Context = { [key: string | symbol]: any };

// Maps module specifiers to module namespace
export type AdditionalModules = { [key: string]: Context };

export enum OptionType {
  NONE, // never
  BOOLEAN, // boolean
  NUMBER, // number
  STRING, // string
  STRING_POSITIONAL, // string
  BOOLEAN_STRING, // boolean | string
  BOOLEAN_NUMBER, // boolean | number
  ARRAY, // string[]
  OBJECT, // any
}

export interface OptionMetadataType<Type extends OptionType, Value> {
  type: Type;
  typeFormat?: Type extends OptionType.OBJECT ? string : undefined;
  name?: string;
  alias?: string;
  description?: string;
  negatable?: Type extends
    | OptionType.BOOLEAN
    | OptionType.BOOLEAN_STRING
    | OptionType.BOOLEAN_NUMBER
    ? boolean
    : undefined;
  logName?: string;
  logValue?: (value: Value) => string | undefined;
  fromEntries?: Type extends OptionType.OBJECT
    ? (entries: [key: string, value: string][]) => Value
    : undefined;
  fromWrangler?: (
    config: WranglerConfig,
    configDir: string,
    log: Log
  ) => Value | undefined;
}

export type OptionMetadata =
  | OptionMetadataType<OptionType.NONE, any>
  | OptionMetadataType<OptionType.BOOLEAN, boolean>
  | OptionMetadataType<OptionType.NUMBER, number>
  | OptionMetadataType<OptionType.STRING, string>
  | OptionMetadataType<OptionType.STRING_POSITIONAL, string>
  | OptionMetadataType<OptionType.BOOLEAN_STRING, boolean | string>
  | OptionMetadataType<OptionType.BOOLEAN_NUMBER, boolean | number>
  | OptionMetadataType<OptionType.ARRAY, any[]>
  | OptionMetadataType<OptionType.OBJECT, any>;

export function Option(
  metadata: OptionMetadata
): (prototype: typeof Plugin.prototype, key: string | symbol) => void {
  return function (prototype, key) {
    (prototype.opts ??= new Map<string | symbol, OptionMetadata>()).set(
      key,
      metadata
    );
  };
}

export interface BeforeSetupResult {
  watch?: string[];
}

export interface SetupResult extends BeforeSetupResult {
  globals?: Context;
  bindings?: Context;
  script?: ScriptBlueprint;
  requiresModuleExports?: boolean;
  additionalModules?: AdditionalModules;
}

// TODO: should probably move Request and Response classes to @miniflare/shared
export interface Mount<Request = any, Response = any> {
  moduleExports?: Context;
  dispatchFetch?: (request: Request) => Promise<Response>;
  usageModel?: UsageModel;
}

export interface PluginContext {
  log: Log;
  compat: Compatibility;
  rootPath: string;
  usageModel?: UsageModel;
  globalAsyncIO?: boolean;
  fetchMock?: MockAgent;
  queueEventDispatcher: QueueEventDispatcher;
  queueBroker: QueueBroker;
  // Cache shared between all mounted instances of this plugin within a
  // Miniflare instance. Cleared after all `beforeReload()` hooks have executed.
  // Used by the Durable Objects plugin to ensure single instances of objects
  // across mounts.
  sharedCache: Map<string, unknown>;
}

export interface TypedMap<ValueMap extends Record<string, unknown>> {
  clear(): void;
  delete(key: keyof ValueMap): boolean;
  forEach(
    callback: (
      value: ValueOf<ValueMap>,
      key: keyof ValueMap,
      map: this
    ) => void,
    thisArg?: any
  ): void;
  get<Key extends keyof ValueMap>(key: Key): ValueMap[Key] | undefined;
  has(key: keyof ValueMap): boolean;
  set<Key extends keyof ValueMap>(key: Key, value: ValueMap[Key]): void;
  keys(): IterableIterator<keyof ValueMap>;
  values(): IterableIterator<ValueOf<ValueMap>>;
  entries(): IterableIterator<[keyof ValueMap, ValueOf<ValueMap>]>;
  [Symbol.iterator](): IterableIterator<[keyof ValueMap, ValueOf<ValueMap>]>;
}

export abstract class Plugin<Options extends Context = never> {
  // Required for PluginOptions type to be correct, no idea why
  // noinspection JSUnusedLocalSymbols
  readonly #phantom!: Options;
  // Metadata added by @Option decorator
  opts?: Map<string | symbol, OptionMetadata>;

  protected constructor(protected readonly ctx: PluginContext) {
    // Make sure this.optionMetadata isn't undefined and has the prototype's value
    this.opts = new.target.prototype.opts;
  }

  protected assignOptions(options?: Options): void {
    if (options === undefined || this.opts === undefined) return;
    for (const key of this.opts.keys()) {
      (this as any)[key] = options[key];
    }
  }

  beforeSetup?(): Awaitable<BeforeSetupResult | void>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setup?(storageFactory: StorageFactory): Awaitable<SetupResult | void>;

  // Called before the worker's script is executed. May be called more times
  // than reload() if the worker is mounted. When a mounted worker is reloaded,
  // it calls beforeReload(), runs the script, but doesn't run reload(). It then
  // instructs the parent to reload, which will call ALL beforeReload() hooks
  // (for itself and all mounts), run just the parent script, then finally call
  // ALL reload() hooks. This ensures all services are accessible to all workers
  // in reload().
  // TODO (someday): this isn't very nice, maybe something to fix in Miniflare 3 :P
  beforeReload?(): Awaitable<void>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reload?(
    bindings: Context,
    moduleExports: Context,
    mounts: Map<string, Mount>
  ): Awaitable<void>;

  // Called when a new instance of the plugin is about to be created,
  // likely delegates to beforeReload or reload
  dispose?(): Awaitable<void>;
}

export type PluginSignature = {
  new (ctx: PluginContext, options?: Context): Plugin<Context>;
  prototype: { opts?: Map<string | symbol, OptionMetadata> };
};
export type PluginSignatures = { [pluginName: string]: PluginSignature };

export type PluginEntries<Plugins extends PluginSignatures> = [
  name: keyof Plugins,
  plugin: ValueOf<Plugins>
][];

// KVPlugin => KVOptions
export type ExtractOptions<Instance> = Instance extends Plugin<infer Options>
  ? Options
  : never;

// { KVPlugin: KVOptions, BuildPlugin: BuildOptions, ... }
export type PluginOptions<Plugins extends PluginSignatures> = {
  [key in keyof Plugins]: ExtractOptions<InstanceType<Plugins[key]>>;
};

// { a: A, b: B, ... } => A | B | ...
export type ValueOf<T> = T[keyof T];

// KVOptions | BuildOptions | ...
export type PluginOptionsUnion<Plugins extends PluginSignatures> = ValueOf<
  PluginOptions<Plugins>
>;

// A | B | ... => A & B & ...
// https://stackoverflow.com/a/50375286
export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

// KVOptions & BuildOptions & ...
export type Options<Plugins extends PluginSignatures> = UnionToIntersection<
  PluginOptionsUnion<Plugins>
>;

export function logOptions<Plugins extends PluginSignatures>(
  plugins: PluginEntries<Plugins>,
  log: Log,
  options: PluginOptions<Plugins>
): void {
  log.debug("Options:");
  for (const [name, plugin] of plugins) {
    const pluginOptions = options[name];
    for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
      const value = pluginOptions[key];
      if (value === undefined || meta.type === OptionType.NONE) continue;
      const keyName =
        meta?.logName ?? titleCase(typeof key === "symbol" ? "<symbol>" : key);
      let str: string | undefined;
      if (meta.logValue) {
        str = (meta.logValue as any)(value);
        if (str === undefined) continue;
      } else if (meta.type === OptionType.OBJECT) {
        str = Object.keys(value).join(", ");
      } else if (meta.type === OptionType.ARRAY) {
        str = value.join(", ");
      } else {
        str = value.toString();
      }
      log.debug(`- ${keyName}: ${str}`);
    }
  }
}
