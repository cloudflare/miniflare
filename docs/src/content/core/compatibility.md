---
order: 8
---

# 📅 Compatibility Dates

- [Compatibility Dates Reference](https://developers.cloudflare.com/workers/platform/compatibility-dates)

## Compatibility Dates

Miniflare uses compatibility dates to opt-into backwards-incompatible changes
from a specific date. If one isn't set, it will default to some time far in the
past.

import ConfigTabs from "../components/mdx/config-tabs";

```js
const mf = new Miniflare({
  compatibilityDate: "2021-11-12",
});
```

## Compatibility Flags

Miniflare also lets you opt-in/out of specific changes using compatibility
flags:

```js
const mf = new Miniflare({
  compatibilityFlags: [
    "formdata_parser_supports_files",
    "durable_object_fetch_allows_relative_url",
  ],
});
```
