import path from "path";
import {
  Option,
  OptionType,
  Plugin,
  PluginContext,
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

  readonly #setupResult: Promise<SetupResult>;

  constructor(ctx: PluginContext, options?: SitesOptions) {
    super(ctx);
    this.assignOptions(options);

    // setup() will be called each time a site file changes, but there's no need
    // to recreate the namespace each time, so create it once and then return it
    this.#setupResult = this.#setup();
  }

  async #setup(): Promise<SetupResult> {
    if (!this.sitePath) return {};

    // Create file KV storage with sanitisation DISABLED so paths containing
    // /'s resolve correctly
    const { FileStorage } = await import("@miniflare/storage-file");
    const sitePath = path.resolve(this.ctx.rootPath, this.sitePath);
    const storage = new FileStorage(sitePath, false);
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
    // Allow `import manifest from "__STATIC_CONTENT_MANIFEST"`
    const additionalModules = {
      __STATIC_CONTENT_MANIFEST: { default: "{}" },
    };

    // Whilst FileStorage will always serve the latest files, we want to
    // force a reload when these files change for live reload.
    return { bindings, watch: [sitePath], additionalModules };
  }

  async setup(): Promise<SetupResult> {
    return this.#setupResult;
  }
}
