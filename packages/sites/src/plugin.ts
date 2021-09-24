import path from "path";
import {
  Log,
  Option,
  OptionType,
  Plugin,
  SetupResult,
  globsToMatcher,
} from "@miniflare/shared";
import { FilteredKVNamespace } from "./filtered";

export interface SitesOptions {
  sitePath?: string;
  siteInclude?: string[];
  siteExclude?: string[];
}

export class SitesPlugin extends Plugin<SitesOptions> implements SitesOptions {
  @Option({
    type: OptionType.STRING,
    name: "site",
    alias: "s",
    description: "Path to serve Workers Site files from",
    logName: "Workers Site Path",
    fromWrangler: ({ site }) => site?.bucket,
  })
  sitePath?: string;

  @Option({
    type: OptionType.ARRAY,
    description: "Glob pattern of site files to serve",
    logName: "Workers Site Include",
    fromWrangler: ({ site }) => site?.include,
  })
  siteInclude?: string[];

  @Option({
    type: OptionType.ARRAY,
    description: "Glob pattern of site files not to serve",
    logName: "Workers Site Exclude",
    fromWrangler: ({ site }) => site?.exclude,
  })
  siteExclude?: string[];

  constructor(log: Log, options?: SitesOptions) {
    super(log);
    this.assignOptions(options);
  }

  async setup(): Promise<SetupResult> {
    if (!this.sitePath) return {};

    // Create file KV storage with sanitisation DISABLED so paths containing
    // /'s resolve correctly
    const { FileStorage } = await import("@miniflare/storage-file");
    const storage = new FileStorage(path.resolve(this.sitePath), false);
    const bindings = {
      __STATIC_CONTENT: new FilteredKVNamespace(storage, {
        readOnly: true,
        include: this.siteInclude && globsToMatcher(this.siteInclude),
        exclude: this.siteExclude && globsToMatcher(this.siteExclude),
      }),
      // Empty manifest means @cloudflare/kv-asset-handler will use the request
      // path as the file path and won't edge cache files
      __STATIC_CONTENT_MANIFEST: {},
    };

    // No need to watch sitePath here, FileStorage will always serve latest
    // files
    // TODO (someday): may want to if doing live reload?
    return { bindings };
  }
}
