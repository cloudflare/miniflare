import {
  Log,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  StorageFactory,
  resolveStoragePersist,
} from "@miniflare/shared";
import { Cache, InternalCacheOptions } from "./cache";
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
  readonly #internalOptions: InternalCacheOptions;

  #warnUsage?: boolean;
  #defaultCache?: CacheInterface;

  constructor(
    options: CacheOptions,
    log: Log,
    storageFactory: StorageFactory,
    internalOptions: InternalCacheOptions
  ) {
    this.#options = options;
    this.#log = log;
    this.#storage = storageFactory;
    this.#warnUsage = options.cacheWarnUsage;
    this.#internalOptions = internalOptions;
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
      this.#internalOptions
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
      this.#storage.storage(cacheName, cachePersist),
      this.#internalOptions
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

  // If global async I/O is blocked (the default), we create a separate
  // CacheStorage instance with it allowed and return that from getCaches()
  // instead. This allows tests (which are outside the request context) to
  // manipulate the cache.
  #unblockedCaches?: CacheStorage;

  constructor(ctx: PluginContext, options?: CacheOptions) {
    super(ctx);
    this.assignOptions(options);
  }

  setup(storageFactory: StorageFactory): SetupResult {
    const persist = resolveStoragePersist(this.ctx.rootPath, this.cachePersist);
    const options: CacheOptions = {
      cache: this.cache,
      cachePersist: persist,
      cacheWarnUsage: this.cacheWarnUsage,
    };
    const files = this.ctx.compat.isEnabled("formdata_parser_supports_files");

    const blockGlobalAsyncIO = !this.ctx.globalAsyncIO;
    const caches = new CacheStorage(options, this.ctx.log, storageFactory, {
      formDataFiles: files,
      blockGlobalAsyncIO,
    });
    this.#unblockedCaches = blockGlobalAsyncIO
      ? new CacheStorage(options, this.ctx.log, storageFactory, {
          formDataFiles: files,
          blockGlobalAsyncIO: false,
        })
      : caches;

    return { globals: { caches } };
  }

  getCaches(): CacheStorage {
    return this.#unblockedCaches!;
  }
}
