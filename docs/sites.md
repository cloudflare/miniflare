# 🌐 Workers Sites

- [Workers Sites Worker Quickstart](https://developers.cloudflare.com/workers/platform/sites/start-from-worker)
- [Workers Sites Configuration Reference](https://developers.cloudflare.com/workers/platform/sites/configuration)

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

When you enable Workers Sites, a read-only KV namespace, bound to
`__STATIC_CONTENT`, is created using the file system (without key sanitisation)
as its storage. An empty object, `{}`, is bound to `__STATIC_CONTENT_MANIFEST`.
This tricks `@cloudflare/kv-asset-handler` into disabling edge caching, meaning
the most up-to-date file is always loaded from disk.
