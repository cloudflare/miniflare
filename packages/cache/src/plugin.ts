import {
  Log,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  StorageFactory,
} from "@miniflare/shared";
import { Cache } from "./cache";
import { CacheError } from "./error";
import { CacheInterface } from "./helpers";
import { NoOpCache } from "./noop";

const DEFAULT_CACHE_NAME = "default";
const MAX_CACHE_NAME_SIZE = 1024;
const NOOP_CACHE = new NoOpCache();

export class CacheStorage {
  readonly #options: CacheOptions;
  readonly #log: Log;
  readonly #storage: StorageFactory;
  readonly #formDataFiles: boolean;
  #warnUsage?: boolean;
  #defaultCache?: CacheInterface;

  constructor(
    options: CacheOptions,
    log: Log,
    storageFactory: StorageFactory,
    formDataFiles = true
  ) {
    this.#options = options;
    this.#log = log;
    this.#storage = storageFactory;
    this.#formDataFiles = formDataFiles;
    this.#warnUsage = options.cacheWarnUsage;
  }

  #maybeWarnUsage(): void {
    if (!this.#warnUsage) return;
    this.#warnUsage = false;
    this.#log.warn(
      "Cache operations will have no impact if you deploy to a workers.dev subdomain!"
    );
  }

  get default(): CacheInterface {
    // Return existing cache if already created
    const defaultCache = this.#defaultCache;
    if (defaultCache) return defaultCache;
    // Return noop cache is caching disabled
    const { cache, cachePersist } = this.#options;
    if (cache === false) return NOOP_CACHE;
    // Return cache, deferring storage await to Cache, since this needs to
    // return synchronously. We want to avoid loading @miniflare/storage-*
    // packages unless the user is actually using storage. Since Cache is
    // included by default, we'd always load these if we didn't do it lazily.
    // There's a risk of an unhandled promise rejection here is the user
    // doesn't do anything with the cache immediately, but this is unlikely.
    this.#maybeWarnUsage();
    return (this.#defaultCache = new Cache(
      this.#storage.storage(DEFAULT_CACHE_NAME, cachePersist),
      this.#formDataFiles
    ));
  }

  async open(cacheName: string): Promise<CacheInterface> {
    if (cacheName === DEFAULT_CACHE_NAME) {
      throw new CacheError(
        "ERR_RESERVED",
        `\"${cacheName}\" is a reserved cache name`
      );
    }
    if (cacheName.length > MAX_CACHE_NAME_SIZE) {
      throw new TypeError("Cache name is too long.");
    }
    // Return noop cache is caching disabled
    const { cache, cachePersist } = this.#options;
    if (cache === false) return NOOP_CACHE;
    // Return regular cache
    this.#maybeWarnUsage();
    return new Cache(
      await this.#storage.storage(cacheName, cachePersist),
      this.#formDataFiles
    );
  }
}

export interface CacheOptions {
  cache?: boolean;
  cachePersist?: boolean | string;
  cacheWarnUsage?: boolean;
}

export class CachePlugin extends Plugin<CacheOptions> implements CacheOptions {
  @Option({
    type: OptionType.BOOLEAN,
    description: "Enable default/named caches (enabled by default)",
    negatable: true,
    logName: "Cache",
    fromWrangler: ({ miniflare }) => miniflare?.cache,
  })
  cache?: boolean;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist cached data (to optional path)",
    logName: "Cache Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.cache_persist,
  })
  cachePersist?: boolean | string;

  @Option({
    type: OptionType.NONE,
    fromWrangler: ({ workers_dev }) => workers_dev,
  })
  cacheWarnUsage?: boolean;

  #caches?: CacheStorage;

  constructor(ctx: PluginContext, options?: CacheOptions) {
    super(ctx);
    this.assignOptions(options);
  }

  setup(storageFactory: StorageFactory): SetupResult {
    this.#caches = new CacheStorage(
      this,
      this.ctx.log,
      storageFactory,
      this.ctx.compat.isEnabled("formdata_parser_supports_files")
    );
    return { globals: { caches: this.#caches } };
  }

  getCaches(): CacheStorage {
    return this.#caches!;
  }
}
