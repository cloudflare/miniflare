import path from "path";
import {
  MaybePromise,
  Storage,
  StorageFactory,
  StorageOperator,
} from "@miniflare/shared";

export class PluginStorageFactory extends StorageFactory {
  private readonly pluginName: string;

  constructor(
    private readonly inner: StorageFactory,
    pluginName: string,
    private readonly defaultPersistRoot = ".mf"
  ) {
    super();
    // Remove "Plugin" suffix and convert to lower-case
    this.pluginName = pluginName
      .substring(0, pluginName.length - 6)
      .toLowerCase();
  }

  private transformOptions(
    namespace: string,
    persist?: boolean | string
  ): [namespace: string, persist?: string] {
    // After transformation, persist will NEVER be a boolean
    if (persist === undefined || persist === false) {
      // If persist is falsy, we'll be using memory storage. We want to make
      // sure the same namespace from different plugins resolves to different
      // storages though, so prefix with the plugin name.
      return [`${this.pluginName}:` + namespace];
    } else if (persist === true) {
      // If persist is true, we want to use the default file storage location.
      return [namespace, path.join(this.defaultPersistRoot, this.pluginName)];
    } else {
      // Otherwise, use custom location/database
      return [namespace, persist];
    }
  }

  operator(
    namespace: string,
    persist?: boolean | string
  ): MaybePromise<StorageOperator> {
    return this.inner.operator(...this.transformOptions(namespace, persist));
  }

  storage(
    namespace: string,
    persist?: boolean | string
  ): MaybePromise<Storage> {
    return this.inner.storage(...this.transformOptions(namespace, persist));
  }
}
