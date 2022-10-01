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
import { AnalyticsEngine } from "./engine";

export interface AnalyticsEngineOptions {
  analyticsEngines?: string[];
  aePersist?: boolean | string;
}

export class AnalyticsEnginePlugin
  extends Plugin<AnalyticsEngineOptions>
  implements AnalyticsEngineOptions
{
  @Option({
    type: OptionType.ARRAY,
    name: "analyticsEngine",
    description: "Analytics Engine namespace to bind",
    logName: "Analytics Engine Namespaces",
    fromWrangler: ({ analytics_engines }) =>
      analytics_engines?.map(({ binding }) => binding),
  })
  analyticsEngines?: string[];

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist Analytics Engine data (to optional path)",
    logName: "Analytics Engine Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.ae_persist,
  })
  aePersist?: boolean | string;
  readonly #persist?: boolean | string;

  constructor(ctx: PluginContext, options?: AnalyticsEngineOptions) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(ctx.rootPath, this.aePersist);
  }

  async getAnalyticsEngine(
    storageFactory: StorageFactory,
    dbName: string
  ): Promise<AnalyticsEngine> {
    const storage = storageFactory.storage(dbName, this.#persist);
    return new AnalyticsEngine(dbName, await storage.getSqliteDatabase());
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    const bindings: Context = {};
    for (const dbName of this.analyticsEngines ?? []) {
      bindings[dbName] = await this.getAnalyticsEngine(storageFactory, dbName);
    }
    return { bindings };
  }
}
