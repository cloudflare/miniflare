# 🌐 Workers Sites

<!--prettier-ignore-start-->
::: warning
This page refers to
[Workers Sites](https://developers.cloudflare.com/workers/platform/sites),
**NOT** [Cloudflare Pages](https://pages.cloudflare.com/). Cloudflare Pages are
not supported.
:::
<!--prettier-ignore-end-->

## Enabling Sites

Workers Sites can be enabled by specifying a path to serve files from. You can
optionally specify glob patterns to include/exclude. If you specify both
`include` and `exclude` options, only `include` will be used and `exclude` will
be ignored:

```shell
$ miniflare --site ./public # or -s
$ miniflare --site ./public --site-include upload_dir
$ miniflare --site ./public --site-exclude ignore_dir
```

```toml
# wrangler.toml
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

The following worker will now serve static files from the `./public` directory.
Note that you'll need a build step to bundle `@cloudflare/kv-asset-handler`. See
[🛠 Builds](/builds.html) for more details:

```js
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

addEventListener("fetch", (event) => {
  event.respondWith(getAssetFromKV(event));
});
```

## Internal Details

When you enable Workers Sites, a read-only namespace using the file system
(without key sanitisation) as its storage is created, and bound to
`__STATIC_CONTENT`. An empty object, `{}`, is bound to
`__STATIC_CONTENT_MANIFEST`. This tricks `@cloudflare/kv-asset-handler` into
disabling edge caching, meaning the most up-to-date file is always loaded from
disk.
