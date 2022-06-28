import {
  Context,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  StorageFactory,
  resolveStoragePersist,
} from "@miniflare/shared";
import { BetaDatabase } from "./database";

export interface D1Options {
  d1Databases?: string[];
  d1Persist?: boolean | string;
}
const D1_BETA_PREFIX = `__D1_BETA__`;

export class D1Plugin extends Plugin<D1Options> implements D1Options {
  @Option({
    type: OptionType.ARRAY,
    name: "d1",
    description: "D1 namespace to bind",
    logName: "D1 Namespaces",
    fromWrangler: ({ d1_databases }) =>
      d1_databases?.map(({ binding }) => binding),
  })
  d1Databases?: string[];

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist D1 data (to optional path)",
    logName: "D1 Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.d1_persist,
  })
  d1Persist?: boolean | string;
  readonly #persist?: boolean | string;

  constructor(ctx: PluginContext, options?: D1Options) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(ctx.rootPath, this.d1Persist);
  }

  async getBetaDatabase(
    storage: StorageFactory,
    dbName: string
  ): Promise<BetaDatabase> {
    return new BetaDatabase(await storage.storage(dbName, this.#persist));
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    const bindings: Context = {};
    for (const dbName of this.d1Databases ?? []) {
      if (dbName.startsWith(D1_BETA_PREFIX)) {
        bindings[dbName] = await this.getBetaDatabase(
          storageFactory,
          // Store it locally without the prefix
          dbName.slice(D1_BETA_PREFIX.length)
        );
      } else {
        console.warn(
          `Not injecting D1 Database for '${dbName}' as this version of Miniflare only supports D1 beta bindings. Upgrade Wrangler and/or Miniflare and try again.`
        );
      }
    }
    return { bindings };
  }
}
