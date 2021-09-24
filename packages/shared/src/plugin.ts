import { titleCase } from "./data";
import { Log } from "./log";
import { ScriptBlueprint } from "./runner";
import { StorageFactory } from "./storage";
import { MaybePromise } from "./sync";
import { WranglerConfig } from "./wrangler";

export type Context = { [key: string]: any };

export enum OptionType {
  NONE, // never
  BOOLEAN, // boolean
  NUMBER, // number
  STRING, // string
  STRING_POSITIONAL, // string
  BOOLEAN_STRING, // boolean | string
  ARRAY, // string[]
  OBJECT, // any
}

export interface OptionMetadataType<Type extends OptionType, Value> {
  type: Type;
  typeFormat?: Type extends OptionType.OBJECT ? string : undefined;
  name?: string;
  alias?: string;
  description?: string;
  logName?: string;
  logValue?: (value: Value) => string;
  fromEntries?: Type extends OptionType.OBJECT
    ? (entries: [key: string, value: string][]) => Value
    : undefined;
  fromWrangler?: (
    config: WranglerConfig,
    configDir: string
  ) => Value | undefined;
}

export type OptionMetadata =
  | OptionMetadataType<OptionType.NONE, never>
  | OptionMetadataType<OptionType.BOOLEAN, boolean>
  | OptionMetadataType<OptionType.NUMBER, number>
  | OptionMetadataType<OptionType.STRING, string>
  | OptionMetadataType<OptionType.STRING_POSITIONAL, string>
  | OptionMetadataType<OptionType.BOOLEAN_STRING, boolean | string>
  | OptionMetadataType<OptionType.ARRAY, string[]>
  | OptionMetadataType<OptionType.OBJECT, any>;

export function Option(
  metadata: OptionMetadata
): (prototype: typeof Plugin.prototype, key: string) => void {
  return function (prototype, key) {
    (prototype.opts ??= new Map<string, OptionMetadata>()).set(key, metadata);
  };
}

export interface BeforeSetupResult {
  watch?: string[];
}

export interface SetupResult extends BeforeSetupResult {
  globals?: Context;
  bindings?: Context;
  scripts?: ScriptBlueprint[];
}

export type ModuleExports = Map<string, Context>;

const kPhantom = Symbol("kPhantom");

export abstract class Plugin<Options extends Context = never> {
  // Required for PluginOptions type to be correct, no idea why
  private readonly [kPhantom]!: Options;
  // Metadata added by @Option decorator
  opts?: Map<string, OptionMetadata>;

  protected constructor(protected readonly log: Log) {
    // Make sure this.optionMetadata isn't undefined and has the prototype's value
    this.opts = new.target.prototype.opts;
  }

  protected assignOptions(options?: Options): void {
    if (options === undefined || this.opts === undefined) return;
    for (const key of this.opts.keys()) {
      (this as any)[key] = options[key];
    }
  }

  beforeSetup?(): MaybePromise<BeforeSetupResult | void>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setup?(storageFactory: StorageFactory): MaybePromise<SetupResult | void>;

  beforeReload?(): MaybePromise<void>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reload?(
    moduleExports: ModuleExports,
    bindings: Context,
    mainScriptPath?: string
  ): MaybePromise<void>;

  // Called when a new instance of the plugin is about to be created
  dispose?(): MaybePromise<void>;
}

export type PluginSignature = {
  new (log: Log, options?: Context): Plugin<Context>;
  prototype: { opts?: Map<string, OptionMetadata> };
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
      const keyName = meta?.logName ?? titleCase(key);
      let s: string | undefined = (meta.logValue as any)?.(value);
      if (s === undefined) {
        if (meta.type === OptionType.OBJECT) s = Object.keys(value).join(", ");
        else if (meta.type === OptionType.ARRAY) s = value.join(", ");
        else s = value.toString();
      }
      log.debug(`- ${keyName}: ${s}`);
    }
  }
}
