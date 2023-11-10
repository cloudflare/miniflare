---
order: 5
---

# 🌐 Workers Sites

- [Workers Sites Worker Quickstart](https://developers.cloudflare.com/workers/platform/sites/start-from-worker)
- [Workers Sites Configuration Reference](https://developers.cloudflare.com/workers/platform/sites/configuration)

<Aside type="warning" header="Warning">

This page refers to
[Workers Sites](https://developers.cloudflare.com/workers/platform/sites),
**not** [Cloudflare Pages](https://pages.cloudflare.com/). Cloudflare Pages are
not directly supported by Miniflare. You must use
[Wrangler 2](https://developers.cloudflare.com/pages/platform/functions#develop-and-preview-locally).

</Aside>

## Enabling Sites

Workers Sites can be enabled by specifying a path to serve files from. You can
optionally specify glob patterns to include/exclude. If you specify both
`include` and `exclude` options, only `include` will be used and `exclude` will
be ignored:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[site]
bucket = "./public"
# Below options are optional
include = ["upload_dir"]
exclude = ["ignore_dir"]
```

```js
const mf = new Miniflare({
  sitePath: "./public",
  // Below options are optional
  siteInclude: ["upload_dir"],
  siteExclude: ["exclude_dir"],
});
```

</ConfigTabs>

The following worker will now serve static files from the `./public` directory.
Note that you'll need a build step to bundle `@cloudflare/kv-asset-handler`. See
[🛠 Builds](/developing/builds) for more details:

```js
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

addEventListener("fetch", (event) => {
  event.respondWith(getAssetFromKV(event));
});
```

## Internal Details

When you enable Workers Sites, a read-only KV namespace, bound to
`__STATIC_CONTENT`, is created using the file system (without key sanitisation)
as its storage. Each entry in the bound `__STATIC_CONTENT_MANIFEST` object
contains a magic prefix that disables edge caching. This means the most
up-to-date file are always loaded from disk. Miniflare also binds this object to
the `__STATIC_CONTENT_MANIFEST` text module.
