import { parseArgv } from "@miniflare/cli-parser";
import {
  BeforeSetupResult,
  Compatibility,
  Context,
  ExtractOptions,
  Log,
  Option,
  OptionType,
  Plugin,
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
  configDir = ""
): ExtractOptions<InstanceType<Plugin>> {
  const result = {} as ExtractOptions<InstanceType<Plugin>>;
  for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
    (result as any)[key] = meta.fromWrangler?.(config, configDir);
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
  arrayOptions?: string[];
  objectOptions?: Record<string, string>;
  arrayObjectOption?: [key: string, value: string][];
  beforeSetupWatch?: string[];
  setupWatch?: string[];
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

  readonly constructedOptions?: TestOptions;
  reloadModuleExports?: Context;
  reloadBindings?: Context;

  constructor(log: Log, compat: Compatibility, options?: TestOptions) {
    super(log, compat);
    this.constructedOptions = options;
    this.assignOptions(options);
  }

  beforeSetup(): BeforeSetupResult {
    this.log.info("beforeSetup");
    return { watch: this.beforeSetupWatch };
  }

  setup(storageFactory: StorageFactory): SetupResult {
    this.log.info("setup");
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
    this.log.info("beforeReload");
  }

  reload(moduleExports: Context, bindings: Context): void {
    this.log.info("reload");
    this.reloadModuleExports = moduleExports;
    this.reloadBindings = bindings;
  }

  dispose(): void {
    this.log.info("dispose");
  }
}
