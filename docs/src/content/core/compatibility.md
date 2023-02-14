---
order: 8
---

# 📅 Compatibility Dates

- [Compatibility Dates Reference](https://developers.cloudflare.com/workers/platform/compatibility-dates)

## Compatibility Dates

Like the Workers runtime, Miniflare uses compatibility dates to opt-into
backwards-incompatible changes from a specific date. If one isn't set, it will
default to some time far in the past.

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --compat-date 2021-11-12
```

```toml
---
filename: wrangler.toml
---
compatibility_date = "2021-11-12"
```

```js
const mf = new Miniflare({
  compatibilityDate: "2021-11-12",
});
```

</ConfigTabs>

## Compatibility Flags

Miniflare also lets you opt-in/out of specific changes using compatibility
flags:

<ConfigTabs>

```sh
$ miniflare --compat-flag formdata_parser_supports_files --compat-flag durable_object_fetch_allows_relative_url
```

```toml
---
filename: wrangler.toml
---
compatibility_flags = [
  "formdata_parser_supports_files",
  "durable_object_fetch_allows_relative_url"
]
```

```js
const mf = new Miniflare({
  compatibilityFlags: [
    "formdata_parser_supports_files",
    "durable_object_fetch_allows_relative_url",
  ],
});
```

</ConfigTabs>

Specifically Miniflare supports the following flags:

- `nodejs_compat` (specifically the _`node:assert`_\*, `node:async_hooks`,
  _`node:buffer`_\*, `node:events`, _`node:util`_\* modules)
- [`transformstream_enable_standard_constructor`/`transformstream_disable_standard_constructor`](https://developers.cloudflare.com/workers/platform/compatibility-dates#compliant-transformstream-constructor)
- [`streams_enable_constructors`/`streams_disable_constructors`](https://developers.cloudflare.com/workers/platform/compatibility-dates#streams-constructors)
- [`export_commonjs_default`/`export_commonjs_namespace`](https://developers.cloudflare.com/workers/platform/compatibility-dates#commonjs-modules-do-not-export-a-module-namespace)
- [`r2_list_honor_include`](https://developers.cloudflare.com/workers/platform/compatibility-dates#r2-bucket-list-respects-the-include-option)
- [`global_navigator`/`no_global_navigator`](https://developers.cloudflare.com/workers/platform/compatibility-dates#global-navigator)
- [`durable_object_fetch_requires_full_url`/`durable_object_fetch_allows_relative_url`](https://developers.cloudflare.com/workers/platform/compatibility-dates#durable-object-stubfetch-requires-a-full-url)
- [`fetch_refuses_unknown_protocols`/`fetch_treats_unknown_protocols_as_http`](https://developers.cloudflare.com/workers/platform/compatibility-dates#fetch-improperly-interprets-unknown-protocols-as-http)
- [`formdata_parser_supports_files`/`formdata_parser_converts_files_to_strings`](https://developers.cloudflare.com/workers/platform/compatibility-dates#formdata-parsing-supports-file)
- [`html_rewriter_treats_esi_include_as_void_tag`](https://developers.cloudflare.com/workers/platform/compatibility-dates#htmlrewriter-handling-of-esiinclude)

\* _Additionally requires the `experimental` compatibility flag to be set_
