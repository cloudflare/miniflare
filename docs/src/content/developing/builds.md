---
order: 0
---

# 🛠 Builds

- [Custom Builds Reference](https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds)

## Custom Builds

Custom builds can be enabled by specifying a build command. You can also specify
a path to run the build in, and a path to watch:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[build]
command = "npm run build"
# Below options are optional
cwd = "build"
watch_dir = "source" # Defaults to "src" if command set

# Extra build watch paths can be specified here,
# they'll get merged with `watch_dir`
[miniflare]
build_watch_dirs = ["source1", "source2"]
```

```js
const mf = new Miniflare({
  buildCommand: "npm run build",
  // Below options are optional
  buildBasePath: "build",
  buildWatchPaths: ["source1", "source2"], // Defaults to "src" if command set
});
```

</ConfigTabs>

The build command will be executed once on initial worker load, then again every
time something in the watched page changes. Note that scripts will only be
reloaded when `scriptPath`'s contents changes, so make sure that's set to your
build output. You can either pass this explicitly, or set it in `wrangler.toml`:

```toml
[build.upload]
dir = "" # Defaults to "dist"
main = "./output.js"
```

<Aside header="Tip">

When running your custom build script, Miniflare will set the environment
variable `MINIFLARE=1`. You can use this to customise build behaviour during
local development.

</Aside>
