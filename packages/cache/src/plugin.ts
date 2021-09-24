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

const kStorage = Symbol("kStorage");
const kOptions = Symbol("kOptions");
const kDefaultCache = Symbol("kDefaultCache");

export class CacheStorage {
  private readonly [kOptions]: CacheOptions;
  private readonly [kStorage]: StorageFactory;
  private [kDefaultCache]?: CacheInterface;

  constructor(options: CacheOptions, storageFactory: StorageFactory) {
    this[kOptions] = options;
    this[kStorage] = storageFactory;
  }

  get default(): CacheInterface {
    // Return existing cache if already created
    const defaultCache = this[kDefaultCache];
    if (defaultCache) return defaultCache;
    // Return noop cache is caching disabled
    const { disableCache, cachePersist } = this[kOptions];
    if (disableCache) return NOOP_CACHE;
    // Return cache, deferring operator await to Cache, since this needs to
    // return synchronously. We want to avoid loading @miniflare/storage-*
    // packages unless the user is actually using storage. Since Cache is
    // included in CorePlugin, we'd always load these if we didn't do it lazily.
    // There's a risk of an unhandled promise rejection here is the user
    // doesn't do anything with the cache immediately, but this is unlikely.
    // TODO: log once if workers_dev = true
    return (this[kDefaultCache] = new Cache(
      this[kStorage].operator(DEFAULT_CACHE_NAME, cachePersist)
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
    const { disableCache, cachePersist } = this[kOptions];
    if (disableCache) return NOOP_CACHE;
    // Return regular cache
    // TODO: log once if workers_dev = true
    return new Cache(await this[kStorage].operator(cacheName, cachePersist));
  }
}

export interface CacheOptions {
  cachePersist?: boolean | string;
  disableCache?: boolean;
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

  // TODO: would probably want warnOnCacheUsage option or something from workers_dev, OptionType.NONE

  constructor(log: Log, options?: CacheOptions) {
    super(log);
    this.assignOptions(options);
  }

  setup(storageFactory: StorageFactory): SetupResult {
    const caches = new CacheStorage(this, storageFactory);
    return { globals: { caches } };
  }
}
