import assert from "assert";
import path from "path";
import {
  Matcher,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SITES_NO_CACHE_PREFIX,
  SetupResult,
  globsToMatcher,
} from "@miniflare/shared";
import type { FileStorage } from "@miniflare/storage-file";
import { FilteredKVNamespace, KeyMapper } from "./filtered";

export interface SitesOptions {
  sitePath?: string;
  siteInclude?: string[];
  siteExclude?: string[];
}

const SITES_KEY_MAPPER: KeyMapper = {
  lookup(key: string): string {
    return key.startsWith(SITES_NO_CACHE_PREFIX)
      ? decodeURIComponent(key.substring(SITES_NO_CACHE_PREFIX.length))
      : key;
  },
  reverseLookup(key: string): string {
    // `encodeURIComponent()` ensures `E-Tag`s used by `@cloudflare/kv-asset-handler`
    // are always byte strings, as required by `undici`
    return SITES_NO_CACHE_PREFIX + encodeURIComponent(key);
  },
};

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

  readonly #include?: Matcher;
  readonly #exclude?: Matcher;

  readonly #resolvedSitePath?: string;
  readonly #storage?: FileStorage;
  readonly #__STATIC_CONTENT?: FilteredKVNamespace;

  constructor(ctx: PluginContext, options?: SitesOptions) {
    super(ctx);
    this.assignOptions(options);
    if (!this.sitePath) return;

    // Lots of sites stuff is constant between reloads, so initialise it once

    // Create include/exclude filters
    this.#include = this.siteInclude && globsToMatcher(this.siteInclude);
    this.#exclude = this.siteExclude && globsToMatcher(this.siteExclude);

    // Create file KV storage with sanitisation DISABLED so paths containing
    // /'s resolve correctly
    const {
      FileStorage,
    }: typeof import("@miniflare/storage-file") = require("@miniflare/storage-file");
    this.#resolvedSitePath = path.resolve(this.ctx.rootPath, this.sitePath);
    this.#storage = new FileStorage(this.#resolvedSitePath, false);

    // Build KV namespace that strips prefix, and only returns matched keys
    this.#__STATIC_CONTENT = new FilteredKVNamespace(this.#storage, {
      readOnly: true,
      map: SITES_KEY_MAPPER,
      include: this.#include,
      exclude: this.#exclude,
    });
  }

  async setup(): Promise<SetupResult> {
    if (!this.sitePath) return {};
    assert(
      this.#resolvedSitePath !== undefined &&
        this.#storage !== undefined &&
        this.#__STATIC_CONTENT !== undefined
    );

    // Build manifest, including prefix to disable caching of sites files
    const staticContentManifest: Record<string, string> = {};
    const result = await this.#storage.list();
    assert.strictEqual(result.cursor, "");
    for (const { name } of result.keys) {
      if (this.#include !== undefined && !this.#include.test(name)) continue;
      if (this.#exclude !== undefined && this.#exclude.test(name)) continue;
      staticContentManifest[name] = SITES_KEY_MAPPER.reverseLookup(name);
    }
    const __STATIC_CONTENT_MANIFEST = JSON.stringify(staticContentManifest);

    const bindings = {
      __STATIC_CONTENT: this.#__STATIC_CONTENT,
      __STATIC_CONTENT_MANIFEST,
    };
    // Allow `import manifest from "__STATIC_CONTENT_MANIFEST"`
    const additionalModules = {
      __STATIC_CONTENT_MANIFEST: { default: __STATIC_CONTENT_MANIFEST },
    };

    // Whilst FileStorage will always serve the latest files, we want to
    // force a reload when these files change for live reload and to rebuild
    // the manifest.
    return { bindings, watch: [this.#resolvedSitePath], additionalModules };
  }
}
