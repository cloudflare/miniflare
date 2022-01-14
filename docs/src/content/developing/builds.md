---
order: 0
---

# 🛠 Builds

- [Custom Builds Reference](https://developers.cloudflare.com/workers/cli-wrangler/configuration#build)

## Custom Builds

Custom builds can be enabled by specifying a build command. You can also specify
a path to run the build in, and a path to watch:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --build-command "npm run build" # or -B
$ miniflare --build-command "npm run build" --build-base-path "build"
$ miniflare --build-command "npm run build" --build-watch-path "source1" --build-watch-path "source2"
```

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

When using the CLI, if `--build-watch-path` is set, `--watch` is automatically
assumed.

</Aside>

<Aside header="Tip">

When running your custom build script, Miniflare will set the environment
variable `MINIFLARE=1`. You can use this to customise build behaviour during
local development.

</Aside>

## Wrangler Builds

Miniflare supports building `webpack` and `rust` type Wrangler projects too.
This is done internally by automatically setting a default custom build
configuration which calls `wrangler build` to do the actual building.

### Webpack

```toml
---
filename: wrangler.toml
---
type = "webpack"
```

Requires
[Wrangler 1](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
to be installed.

<Aside header="Tip">

If you can, use [esbuild](https://esbuild.github.io/) for much faster builds and
reloads. See the [⚡️ Developing with esbuild](/developing/esbuild) recipe for
an example.

</Aside>

### Rust

```toml
---
filename: wrangler.toml
---
type = "rust"
```

Requires
[Wrangler 1](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
and [Rust](https://rustup.rs/) to be installed.
