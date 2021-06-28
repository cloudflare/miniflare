import { FileKVStorage, FilteredKVStorageNamespace } from "../kv";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

export class SitesModule extends Module {
  buildEnvironment(options: ProcessedOptions): Context {
    if (!options.sitePath) return {};

    // Create file KV storage with sanitisation DISABLED so paths containing
    // /'s resolve correctly
    const storage = new FileKVStorage(options.sitePath, false);
    return {
      __STATIC_CONTENT: new FilteredKVStorageNamespace(storage, {
        readOnly: true,
        include: options.siteIncludeRegexps,
        exclude: options.siteExcludeRegexps,
      }),
      // Empty manifest means @cloudflare/kv-asset-handler will use the request
      // path as the file path and won't edge cache files
      __STATIC_CONTENT_MANIFEST: {},
    };
  }
}
