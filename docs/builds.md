# 🛠 Builds

- [Custom Builds Reference](https://developers.cloudflare.com/workers/cli-wrangler/configuration#build)

## Custom Builds

Custom builds can be enabled by specifying a build command. You can also specify
a path to run the build in, and a path to watch:

```shell
$ miniflare --build-command "npm run build"
$ miniflare --build-command "npm run build" --build-base-path "build"
$ miniflare --build-command "npm run build" --build-watch-path "source"
```

```toml
# wrangler.toml
[build]
command = "npm run build"
# Below options are optional
cwd = "build"
watch_dir = "source" # Defaults to "src" if command set
```

```js
const mf = new Miniflare({
  buildCommand: "npm run build",
  // Below options are optional
  buildBasePath: "build",
  buildWatchPath: "source", // Defaults to "src" if command set
});
```

The build command will be executed once on initial worker load, then again every
time something in the watched page changes. Note that scripts will only be
reloaded when `scriptPath`'s contents changes, so make sure that's set to your
build output. You can either pass this explicitly, or set it in `wrangler.toml`:

```toml
[build.upload]
dir = "" # Defaults to "dist"
main = "./output.js"
```

## Wrangler Builds

Miniflare supports building `webpack` and `rust` type Wrangler projects too.
This is done internally by automatically setting a default custom build
configuration which calls `wrangler build` to do the actual building.

### Webpack

```toml
# wrangler.toml
type = "webpack"
```

Requires
[Wrangler](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
to be installed.

<!--prettier-ignore-start-->
::: tip
If you can, use [esbuild](https://esbuild.github.io/) for much faster builds and
reloads. See the [⚡️ Developing with esbuild](/recipes/esbuild.html) recipe for
an example.
:::
<!--prettier-ignore-end-->

### Rust

```toml
# wrangler.toml
type = "rust"
```

Requires
[Wrangler](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
and [Rust](https://rustup.rs/) to be installed.
