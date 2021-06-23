import path from "path";
import { Cache } from "../kv";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

const defaultPersistRoot = path.resolve(".mf", "cache");

export class CacheModule extends Module {
  private readonly storageFactory: KVStorageFactory;

  constructor(log: Log, persistRoot = defaultPersistRoot) {
    super(log);
    this.storageFactory = new KVStorageFactory(persistRoot);
  }

  getCache(name = "default", persist?: boolean | string): Cache {
    return new Cache(this.storageFactory.getStorage(name, persist));
  }

  buildSandbox(options: ProcessedOptions): Context {
    const defaultCache = this.getCache(undefined, options.cachePersist);
    return { caches: { default: defaultCache } };
  }
}
