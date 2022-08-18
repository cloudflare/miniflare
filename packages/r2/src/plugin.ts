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
import { R2Bucket } from "./bucket";

export interface R2Options {
  r2Buckets?: string[];
  r2Persist?: boolean | string;
}

export class R2Plugin extends Plugin<R2Options> implements R2Options {
  @Option({
    type: OptionType.ARRAY,
    name: "r2",
    alias: "r",
    description: "R2 bucket to bind",
    logName: "R2 Buckets",
    fromWrangler: ({ r2_buckets }) => r2_buckets?.map(({ binding }) => binding),
  })
  r2Buckets?: string[];

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist R2 data (to optional path)",
    logName: "R2 Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.r2_persist,
  })
  r2Persist?: boolean | string;
  readonly #persist?: boolean | string;

  constructor(ctx: PluginContext, options?: R2Options) {
    super(ctx);
    this.assignOptions(options);
    this.#persist = resolveStoragePersist(ctx.rootPath, this.r2Persist);
  }

  async getBucket(
    storage: StorageFactory,
    bucket: string,
    blockGlobalAsyncIO = false
  ): Promise<R2Bucket> {
    return new R2Bucket(await storage.storage(bucket, this.#persist), {
      blockGlobalAsyncIO,
    });
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    const blockGlobalAsyncIO = !this.ctx.globalAsyncIO;
    const bindings: Context = {};
    for (const bucket of this.r2Buckets ?? []) {
      bindings[bucket] = await this.getBucket(
        storageFactory,
        bucket,
        blockGlobalAsyncIO
      );
    }
    return { bindings };
  }
}
