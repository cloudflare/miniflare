import { FileKVStorage, FilteredKVStorageNamespace } from "../kv";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

// TODO: document this
const manifestProxy = new Proxy(Object.freeze({}), {
  get: (target, prop) => prop,
});

export class SitesModule extends Module {
  buildEnvironment(options: ProcessedOptions): Context {
    if (!options.sitePath) return {};

    const storage = new FileKVStorage(options.sitePath);
    return {
      __STATIC_CONTENT: new FilteredKVStorageNamespace(storage, {
        readOnly: true,
        include: options.siteIncludeRegexps,
        exclude: options.siteExcludeRegexps,
      }),
      __STATIC_CONTENT_MANIFEST: manifestProxy,
    };
  }
}
