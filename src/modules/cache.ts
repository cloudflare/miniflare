import path from "path";
import { MiniflareError } from "../error";
import { Cache } from "../kv";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

const defaultPersistRoot = path.resolve(".mf", "cache");
const defaultCacheName = "default";

export class CacheModule extends Module {
  constructor(
    log: Log,
    private storageFactory = new KVStorageFactory(defaultPersistRoot)
  ) {
    super(log);
  }

  getCache(name = defaultCacheName, persist?: boolean | string): Cache {
    return new Cache(this.storageFactory.getStorage(name, persist));
  }

  buildSandbox(options: ProcessedOptions): Context {
    const defaultCache = this.getCache(undefined, options.cachePersist);
    return {
      caches: {
        default: defaultCache,
        open: async (name: string) => {
          if (name === defaultCacheName) {
            throw new MiniflareError(
              `\"${defaultCacheName}\" is a reserved cache name`
            );
          }
          return this.getCache(name, options.cachePersist);
        },
      },
    };
  }
}
