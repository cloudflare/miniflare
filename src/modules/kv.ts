import path from "path";
import { KVStorageNamespace } from "../kv";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

const defaultPersistRoot = path.resolve(".mf", "kv");

export class KVModule extends Module {
  private readonly _storageFactory: KVStorageFactory;

  constructor(log: Log, persistRoot = defaultPersistRoot) {
    super(log);
    this._storageFactory = new KVStorageFactory(persistRoot);
  }

  getNamespace(
    namespace: string,
    persist?: boolean | string
  ): KVStorageNamespace {
    return new KVStorageNamespace(
      this._storageFactory.getStorage(namespace, persist)
    );
  }

  buildEnvironment(options: ProcessedOptions): Context {
    const environment: Context = {};
    for (const namespace of options.kvNamespaces ?? []) {
      environment[namespace] = this.getNamespace(namespace, options.kvPersist);
    }
    return environment;
  }
}
