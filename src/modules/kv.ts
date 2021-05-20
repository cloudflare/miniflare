import path from "path";
import { KVStorageNamespace } from "../kv";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Module, Sandbox } from "./module";

const defaultPersistRoot = path.resolve(".mf", "kv");

export class KVModule extends Module {
  private readonly storageFactory: KVStorageFactory;

  constructor(log: Log, persistRoot = defaultPersistRoot) {
    super(log);
    this.storageFactory = new KVStorageFactory(persistRoot);
  }

  getNamespace(
    namespace: string,
    persist?: boolean | string
  ): KVStorageNamespace {
    return new KVStorageNamespace(
      this.storageFactory.getStorage(namespace, persist)
    );
  }

  buildSandbox(options: ProcessedOptions): Sandbox {
    const sandbox: Sandbox = {};
    for (const namespace of options.kvNamespaces ?? []) {
      sandbox[namespace] = this.getNamespace(namespace, options.kvPersist);
    }
    return sandbox;
  }
}
