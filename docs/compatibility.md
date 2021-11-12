# 📅 Compatibility Dates

- [Compatibility Dates Reference](https://developers.cloudflare.com/workers/platform/compatibility-dates)

## Compatibility Dates

Like the Workers runtime, Miniflare uses compatibility dates to opt-into
backwards-incompatible changes from a specific date. If one isn't set, it will
default to some time far in the past.

```shell
$ miniflare --compat-date 2021-11-12
```

```toml
# wrangler.toml
compatibility_date = "2021-11-12"
```

```js
const mf = new Miniflare({
  compatibilityDate: "2021-11-12",
});
```

## Compatibility Flags

Miniflare also lets you opt-in/out of specific changes using compatibility
flags:

```shell
$ miniflare --compat-flag formdata_parser_supports_files --compat-flag durable_object_fetch_allows_relative_url
```

```toml
# wrangler.toml
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

Specifically Miniflare supports the following flags:

- [`durable_object_fetch_requires_full_url`/`durable_object_fetch_allows_relative_url`](https://developers.cloudflare.com/workers/platform/compatibility-dates#durable-object-stubfetch-requires-a-full-url)
- [`fetch_refuses_unknown_protocols`/`fetch_treats_unknown_protocols_as_http`](https://developers.cloudflare.com/workers/platform/compatibility-dates#fetch-improperly-interprets-unknown-protocols-as-http)
- [`formdata_parser_supports_files`/`formdata_parser_converts_files_to_strings`](https://developers.cloudflare.com/workers/platform/compatibility-dates#formdata-parsing-supports-file)
