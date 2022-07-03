import { parseArgv } from "@miniflare/cli-parser";
import {
  BeforeSetupResult,
  Context,
  ExtractOptions,
  Log,
  Mount,
  NoOpLog,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  PluginSignature,
  SetupResult,
  StorageFactory,
  WranglerConfig,
  logOptions,
} from "@miniflare/shared";
import { TestLog } from "./log";

export function parsePluginArgv<Plugin extends PluginSignature>(
  plugin: Plugin,
  argv: string[]
): ExtractOptions<InstanceType<Plugin>> {
  return parseArgv({ plugin }, argv) as any;
}

export function parsePluginWranglerConfig<Plugin extends PluginSignature>(
  plugin: Plugin,
  config: WranglerConfig,
  configDir = "",
  log: Log = new NoOpLog()
): ExtractOptions<InstanceType<Plugin>> {
  const result = {} as ExtractOptions<InstanceType<Plugin>>;
  for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
    (result as any)[key] = meta.fromWrangler?.(config, configDir, log);
  }
  return result;
}

export function logPluginOptions<Plugin extends PluginSignature>(
  plugin: Plugin,
  options: ExtractOptions<InstanceType<Plugin>>
): string[] {
  const log = new TestLog();
  logOptions([["plugin", plugin]], log, { plugin: options });
  return log.logs
    .slice(1) // Remove "Options:" header
    .map(([, message]) => message.substring(2)); // Remove "- " prefix
}

export interface TestOptions {
  noneOption?: string;
  booleanOption?: boolean;
  numberOption?: number;
  stringOption?: string;
  positionalStringOption?: string;
  booleanStringOption?: boolean | string;
  booleanNumberOption?: boolean | number;
  arrayOptions?: string[];
  objectOptions?: Record<string, string>;
  arrayObjectOption?: [key: string, value: string][];
  beforeSetupWatch?: string[];
  setupWatch?: string[];
  hookLogIdentifier?: string;
}

export class TestPlugin extends Plugin<TestOptions> implements TestOptions {
  @Option({ type: OptionType.NONE })
  noneOption?: string;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "b",
    description: "Boolean option",
  })
  booleanOption?: boolean;

  @Option({
    type: OptionType.NUMBER,
    name: "num-option",
    alias: "n",
    description: "Number option",
  })
  numberOption?: number;

  @Option({ type: OptionType.STRING, alias: "s" })
  stringOption?: string;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Boolean/string option",
  })
  booleanStringOption?: boolean | string;

  @Option({
    type: OptionType.BOOLEAN_NUMBER,
    description: "Boolean/number option",
  })
  booleanNumberOption?: boolean | number;

  @Option({ type: OptionType.ARRAY })
  arrayOptions?: string[];

  @Option({ type: OptionType.OBJECT, alias: "o" })
  objectOptions?: Record<string, string>;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "KEY=THING",
    fromEntries: (entries) => entries,
  })
  arrayObjectOption?: [key: string, thing: string][];

  @Option({ type: OptionType.NONE })
  beforeSetupWatch?: string[];
  @Option({ type: OptionType.NONE })
  setupWatch?: string[];
  @Option({ type: OptionType.NONE })
  hookLogIdentifier?: string;

  readonly constructedOptions?: TestOptions;
  reloadBindings?: Context;
  reloadModuleExports?: Context;
  reloadMounts?: Map<string, Mount>;

  constructor(ctx: PluginContext, options?: TestOptions) {
    super(ctx);
    this.constructedOptions = options;
    this.assignOptions(options);
    this.hookLogIdentifier ??= "";
  }

  beforeSetup(): BeforeSetupResult {
    this.ctx.log.info(`${this.hookLogIdentifier}beforeSetup`);
    return { watch: this.beforeSetupWatch };
  }

  setup(storageFactory: StorageFactory): SetupResult {
    this.ctx.log.info(`${this.hookLogIdentifier}setup`);
    return {
      globals: {
        // Test overriding a built-in, CorePlugin should be loaded first so
        // this should be preferred. BigUint64Array seemed like the least likely
        // thing to be used, so hopefully this doesn't cause problems later on.
        BigUint64Array: "overridden",
      },
      bindings: {
        // Test plugin-namespaced storage
        STORAGE: storageFactory.storage("STORAGE"),
      },
      watch: this.setupWatch,
    };
  }

  beforeReload(): void {
    this.ctx.log.info(`${this.hookLogIdentifier}beforeReload`);
  }

  reload(
    bindings: Context,
    moduleExports: Context,
    mounts: Map<string, Mount>
  ): void {
    this.ctx.log.info(`${this.hookLogIdentifier}reload`);
    this.reloadBindings = bindings;
    this.reloadModuleExports = moduleExports;
    this.reloadMounts = mounts;
  }

  dispose(): void {
    this.ctx.log.info(`${this.hookLogIdentifier}dispose`);
  }
}
