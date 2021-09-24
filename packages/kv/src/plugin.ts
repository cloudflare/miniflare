import {
  Context,
  Log,
  Option,
  OptionType,
  Plugin,
  SetupResult,
  StorageFactory,
} from "@miniflare/shared";
import { KVNamespace } from "./namespace";

export interface KVOptions {
  kvNamespaces?: string[];
  kvPersist?: boolean | string;
}

export class KVPlugin extends Plugin<KVOptions> implements KVOptions {
  @Option({
    type: OptionType.ARRAY,
    name: "kv",
    alias: "k",
    description: "KV namespace to bind",
    logName: "KV Namespaces",
    fromWrangler: ({ kv_namespaces }) =>
      kv_namespaces?.map(({ binding }) => binding),
  })
  kvNamespaces?: string[];

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Persist KV data (to optional path)",
    logName: "KV Persistence",
    fromWrangler: ({ miniflare }) => miniflare?.kv_persist,
  })
  kvPersist?: boolean | string;

  constructor(log: Log, options?: KVOptions) {
    super(log);
    this.assignOptions(options);
  }

  async getNamespace(
    storage: StorageFactory,
    namespace: string
  ): Promise<KVNamespace> {
    return new KVNamespace(await storage.operator(namespace, this.kvPersist));
  }

  async setup(storageFactory: StorageFactory): Promise<SetupResult> {
    const bindings: Context = {};
    for (const namespace of this.kvNamespaces ?? []) {
      bindings[namespace] = await this.getNamespace(storageFactory, namespace);
    }
    return { bindings };
  }
}
