import path from "path";
import { Awaitable, Storage, StorageFactory } from "@miniflare/shared";

export class PluginStorageFactory implements StorageFactory {
  private readonly pluginName: string;

  constructor(
    private readonly inner: StorageFactory,
    pluginName: string,
    private readonly defaultPersistRoot = ".mf"
  ) {
    // Remove "Plugin" suffix and convert to lower-case
    this.pluginName = pluginName
      .substring(0, pluginName.length - 6)
      .toLowerCase();
  }

  storage(namespace: string, persist?: boolean | string): Storage {
    // After transformation, persist will NEVER be a boolean
    if (persist === undefined || persist === false) {
      // If persist is falsy, we'll be using memory storage. We want to make
      // sure the same namespace from different plugins resolves to different
      // storages though, so prefix with the plugin name.
      return this.inner.storage(`${this.pluginName}:` + namespace);
    } else if (persist === true) {
      // If persist is true, we want to use the default file storage location.
      return this.inner.storage(
        namespace,
        path.join(this.defaultPersistRoot, this.pluginName)
      );
    } else {
      // Otherwise, use custom location/database
      return this.inner.storage(namespace, persist);
    }
  }

  dispose(): Awaitable<void> {
    return this.inner.dispose?.();
  }
}
