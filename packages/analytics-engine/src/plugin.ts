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
import type { SqliteDB } from "@miniflare/shared";
import { AnalyticsEngine, FormatJSON, _format, _prepare } from "./engine";

export type ProcessedAnalyticsEngine = Record<string, string>; // { [name]: dataset }

export interface AnalyticsEngineOptions {
  analyticsEngines?: ProcessedAnalyticsEngine;
  aePersist?: boolean | string;
}

export class AnalyticsEnginePlugin
  extends Plugin<AnalyticsEngineOptions>
  implements AnalyticsEngineOptions
{
  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=DATASET",
    name: "ae",
    alias: "a",
    description: "Analytics Engine to bind",
    logName: "Analytics Engine Names",
    fromEntries: (entries) =>
      Object.fromEntries(
        entries.map(([name, datasetName]) => {
          return [name, datasetName];
        })
      ),
    fromWrangler: ({ bindings }) =>
      bindings?.reduce((objects, { type, name, dataset }) => {
        if (type === "analytics_engine") objects[name] = dataset;
        return objects;
      }, {} as ProcessedAnalyticsEngine),
  })
  analyticsEngines?: ProcessedAnalyticsEngine;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist Analytics Engine data (to optional path)",
    logName: "Analytics Engine Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.ae_persist,
  })
  aePersist?: boolean | string;
  readonly #persist?: boolean | string;

  #db?: SqliteDB;

  constructor(ctx: PluginContext, options?: AnalyticsEngineOptions) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(ctx.rootPath, this.aePersist);
  }

  async getAnalyticsEngine(
    storageFactory: StorageFactory,
    name: string
  ): Promise<AnalyticsEngine> {
    const dataset = this.analyticsEngines?.[name];
    if (dataset === undefined) {
      throw new Error(`Analytics Engine "${name}" does not exist.`);
    }
    await this.#setup(storageFactory);
    // @ts-expect-error: #setup already ensures #db exists.
    return new AnalyticsEngine(dataset, this.#db);
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    await this.#setup(storageFactory);
    const bindings: Context = {};
    for (const name of Object.keys(this.analyticsEngines ?? {})) {
      bindings[name] = await this.getAnalyticsEngine(storageFactory, name);
    }
    return { bindings };
  }

  async getStorage(storageFactory: StorageFactory): Promise<SqliteDB> {
    await this.#setup(storageFactory);
    // @ts-expect-error: #setup already ensures #db exists.
    return this.#db;
  }

  async query(
    storageFactory: StorageFactory,
    input: string
  ): Promise<string | FormatJSON> {
    await this.#setup(storageFactory);
    const [query, format] = _prepare(input);
    // @ts-expect-error: #setup already ensures #db exists.
    const data = this.#db.prepare(query).all();
    return _format(data, format);
  }

  async #setup(storageFactory: StorageFactory): Promise<void> {
    if (this.#db === undefined) {
      // grab storage
      const storage = storageFactory.storage(
        "__MINIFLARE_ANALYTICS_ENGINE_STORAGE__",
        this.#persist
      );
      // setup db
      this.#db = await storage.getSqliteDatabase();
    }
  }
}
