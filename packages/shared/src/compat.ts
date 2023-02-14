import { numericCompare } from "./data";

export interface CompatibilityFeature {
  defaultAsOf?: string;
  enableFlag: CompatibilityEnableFlag;
  disableFlag?: CompatibilityDisableFlag;
}

// See https://developers.cloudflare.com/workers/platform/compatibility-dates#change-history
// This list only includes flags currently supported by Miniflare, meaning users
// will get a type error if they try to use an unsupported flag via the API,
// and they won't be logged in the "Enabled Compatibility Flags" section.
export type CompatibilityEnableFlag =
  | "nodejs_compat"
  | "streams_enable_constructors"
  | "transformstream_enable_standard_constructor"
  | "export_commonjs_default"
  | "r2_list_honor_include"
  | "global_navigator"
  | "durable_object_fetch_requires_full_url"
  | "fetch_refuses_unknown_protocols"
  | "formdata_parser_supports_files"
  | "html_rewriter_treats_esi_include_as_void_tag"
  | "experimental";
export type CompatibilityDisableFlag =
  | "streams_disable_constructors"
  | "transformstream_disable_standard_constructor"
  | "export_commonjs_namespace"
  | "no_global_navigator"
  | "durable_object_fetch_allows_relative_url"
  | "fetch_treats_unknown_protocols_as_http"
  | "formdata_parser_converts_files_to_strings";
export type CompatibilityFlag =
  | CompatibilityEnableFlag
  | CompatibilityDisableFlag;

const FEATURES: CompatibilityFeature[] = [
  {
    enableFlag: "nodejs_compat",
  },
  {
    defaultAsOf: "2022-11-30",
    enableFlag: "streams_enable_constructors",
    disableFlag: "streams_disable_constructors",
  },
  {
    defaultAsOf: "2022-11-30",
    enableFlag: "transformstream_enable_standard_constructor",
    disableFlag: "transformstream_disable_standard_constructor",
  },
  {
    defaultAsOf: "2022-10-31",
    enableFlag: "export_commonjs_default",
    disableFlag: "export_commonjs_namespace",
  },
  {
    defaultAsOf: "2022-08-04",
    enableFlag: "r2_list_honor_include",
  },
  {
    defaultAsOf: "2022-03-21",
    enableFlag: "global_navigator",
    disableFlag: "no_global_navigator",
  },
  {
    defaultAsOf: "2021-11-10",
    enableFlag: "durable_object_fetch_requires_full_url",
    disableFlag: "durable_object_fetch_allows_relative_url",
  },
  {
    defaultAsOf: "2021-11-10",
    enableFlag: "fetch_refuses_unknown_protocols",
    disableFlag: "fetch_treats_unknown_protocols_as_http",
  },
  {
    defaultAsOf: "2021-11-03",
    enableFlag: "formdata_parser_supports_files",
    disableFlag: "formdata_parser_converts_files_to_strings",
  },
  {
    enableFlag: "html_rewriter_treats_esi_include_as_void_tag",
  },
  {
    enableFlag: "experimental",
  },
];

export class Compatibility {
  #enabled = new Set<CompatibilityEnableFlag>();

  constructor(
    private compatibilityDate = "1970-01-01",
    private compatibilityFlags: CompatibilityFlag[] = []
  ) {
    this.#rebuildEnabled();
  }

  #rebuildEnabled(): void {
    this.#enabled.clear();
    const flags = new Set(this.compatibilityFlags);
    for (const { defaultAsOf, enableFlag, disableFlag } of FEATURES) {
      const disabledExplicitly = disableFlag && flags.has(disableFlag);
      if (disabledExplicitly) continue;

      const enabledExplicitly = flags.has(enableFlag);
      const enabledAutomatically =
        defaultAsOf && numericCompare(defaultAsOf, this.compatibilityDate) <= 0;
      if (enabledExplicitly || enabledAutomatically) {
        this.#enabled.add(enableFlag);
      }
    }
  }

  isEnabled(flag: CompatibilityEnableFlag): boolean {
    return this.#enabled.has(flag);
  }

  update(
    compatibilityDate = "1970-01-01",
    compatibilityFlags: CompatibilityFlag[] = []
  ): boolean {
    if (
      this.compatibilityDate === compatibilityDate &&
      this.compatibilityFlags.length === compatibilityFlags.length &&
      this.compatibilityFlags.every((flag, i) => compatibilityFlags[i] === flag)
    ) {
      return false;
    }
    this.compatibilityDate = compatibilityDate;
    this.compatibilityFlags = compatibilityFlags;
    this.#rebuildEnabled();
    return true;
  }

  get enabled(): CompatibilityEnableFlag[] {
    return [...this.#enabled];
  }
}
