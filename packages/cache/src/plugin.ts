import {
  Log,
  MiniflareError,
  Option,
  OptionType,
  Plugin,
  SetupResult,
  StorageFactory,
} from "@miniflare/shared";
import { Cache } from "./cache";
import { CacheInterface } from "./helpers";
import { NoOpCache } from "./noop";

const DEFAULT_CACHE_NAME = "default";
const MAX_CACHE_NAME_SIZE = 1024;
const NOOP_CACHE = new NoOpCache();

export type CacheErrorCode = "ERR_RESERVED";

export class CacheError extends MiniflareError<CacheErrorCode> {}

export class CacheStorage {
  readonly #options: CacheOptions;
  readonly #log: Log;
  readonly #storage: StorageFactory;
  #warnUsage?: boolean;
  #defaultCache?: CacheInterface;

  constructor(options: CacheOptions, log: Log, storageFactory: StorageFactory) {
    this.#options = options;
    this.#log = log;
    this.#storage = storageFactory;
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
    const { disableCache, cachePersist } = this.#options;
    if (disableCache) return NOOP_CACHE;
    // Return cache, deferring storage await to Cache, since this needs to
    // return synchronously. We want to avoid loading @miniflare/storage-*
    // packages unless the user is actually using storage. Since Cache is
    // included by default, we'd always load these if we didn't do it lazily.
    // There's a risk of an unhandled promise rejection here is the user
    // doesn't do anything with the cache immediately, but this is unlikely.
    this.#maybeWarnUsage();
    return (this.#defaultCache = new Cache(
      this.#storage.storage(DEFAULT_CACHE_NAME, cachePersist)
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
    const { disableCache, cachePersist } = this.#options;
    if (disableCache) return NOOP_CACHE;
    // Return regular cache
    this.#maybeWarnUsage();
    return new Cache(await this.#storage.storage(cacheName, cachePersist));
  }
}

export interface CacheOptions {
  cachePersist?: boolean | string;
  disableCache?: boolean;
  cacheWarnUsage?: boolean;
}

export class CachePlugin extends Plugin<CacheOptions> implements CacheOptions {
  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist cached data (to optional path)",
    logName: "Cache Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.cache_persist,
  })
  cachePersist?: boolean | string;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Disable default/named caches",
    logName: "Cache Disabled",
    fromWrangler: ({ miniflare }) => miniflare?.disable_cache,
  })
  disableCache?: boolean;

  @Option({
    type: OptionType.NONE,
    fromWrangler: ({ workers_dev }) => workers_dev,
  })
  cacheWarnUsage?: boolean;

  constructor(log: Log, options?: CacheOptions) {
    super(log);
    this.assignOptions(options);
  }

  setup(storageFactory: StorageFactory): SetupResult {
    const caches = new CacheStorage(this, this.log, storageFactory);
    return { globals: { caches } };
  }
}
