# 💻 Using the CLI

The CLI is the easiest way to get started with Miniflare. It lets you start a
local HTTP server that serves requests using your worker.

## Installation

Miniflare is installed using `npm`:

```shell
$ npm install -g miniflare # either globally...
$ npm install -D miniflare # ...or as a dev dependency
```

You can also install and invoke the CLI using `npx`:

```shell
$ npx miniflare
```

## Usage

If `worker.js` contains the following worker script:

```js
addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello Miniflare!"));
});
```

...running the following command will start a local HTTP server listening on
port `8787` that responds with `Hello Miniflare!` to all requests:

```shell{1}
$ miniflare worker.js
[mf:inf] Worker reloaded!
[mf:inf] Listening on :8787
[mf:inf] - http://127.0.0.1:8787
```

<!--prettier-ignore-start-->
::: tip
If you're building your worker beforehand, make sure you pass the path of your built output to Miniflare, not your input source code.
See [🛠 Builds](/builds.html) for more details.
:::
<!--prettier-ignore-end-->

<!--prettier-ignore-start-->
::: warning
[📚 Modules](/modules.html) support currently requires the
`--experimental-vm-modules` flag. This is enabled by default, but requires the
`-S` flag of `/usr/bin/env`. If your operating system doesn't support the `-S`
flag (e.g. Ubuntu 18.04), you can run the following instead:

```shell
$ node --experimental-vm-modules ./node_modules/.bin/miniflare worker.js
```
:::
<!--prettier-ignore-end-->

### Watching and Debugging

Add `--watch`/`-w` and `--debug`/`-d` flags to reload the worker whenever
`worker.js` changes and log debug information (including processed options)
respectively:

```shell{1}
$ miniflare worker.js --watch --debug
[mf:dbg] Options:
[mf:dbg] - Scripts: worker.js
[mf:dbg] Reloading worker.js...
[mf:inf] Worker reloaded!
[mf:dbg] Watching .env, worker.js, wrangler.toml...
[mf:inf] Listening on :8787
[mf:inf] - http://127.0.0.1:8787
```

### Configuration Autoloading

Note that `.env` and `wrangler.toml` files are also being watched. These files
are always loaded automatically and configure your worker's environment in
addition to the CLI flags. See the
[Wrangler Configuration](#wrangler-configuration) reference below for more
details, but as an example, with the following `wrangler.toml` file and
`worker.js` files:

```toml
[vars]
KEY = "value"
```

```js
addEventListener("fetch", (event) => {
  event.respondWith(new Response(KEY));
});
```

...the local HTTP server would respond with `value` to all requests. The
[Guide](/fetch.html) goes into more detail on configuring specific features. To
load a different `wrangler.toml` file, use the `--wrangler-config`/`-c` flag:

```shell
$ miniflare worker.js --wrangler-config wrangler.other.toml
```

### Script Requirement

The only required option is the script to run. This can either be passed as a
command line argument as we've been doing so far, or in a `wrangler.toml` file:

```toml
[build.upload]
dir = "" # Defaults to "dist"
main = "./worker.js"
```

## Reference

### Flags

```
Usage: miniflare [script] [options]

Options:
  -h, --help              Show help                                    [boolean]
  -v, --version           Show version number                          [boolean]
  -H, --host              HTTP server host to listen on (all by default)[string]
  -p, --port              HTTP server port (8787 by default)            [number]
  -d, --debug             Log debug messages                           [boolean]
  -c, --wrangler-config   Path to wrangler.toml                         [string]
      --wrangler-env      Environment in wrangler.toml to use           [string]
  -m, --modules           Enable modules                               [boolean]
      --modules-rule      Modules import rule (TYPE=GLOB)                [array]
      --build-command     Command to build project                      [string]
      --build-base-path   Working directory for build command           [string]
      --build-watch-path  Directory to watch for rebuilding on changes  [string]
  -w, --watch             Watch files for changes                      [boolean]
  -u, --upstream          URL of upstream origin                        [string]
  -t, --cron              Cron pattern to trigger scheduled events with  [array]
  -k, --kv                KV namespace to bind                           [array]
      --kv-persist        Path to persist KV data to (omit path for default)
      --cache-persist     Path to persist cached data to (omit path for default)
  -s, --site              Path to serve Workers Site files from         [string]
      --site-include      Glob pattern of site files to serve            [array]
      --site-exclude      Glob pattern of site files not to serve        [array]
  -o, --do                Durable Object to bind (NAME=CLASS)            [array]
      --do-persist        Path to persist Durable Object data to (omit path for
                          default)
  -e, --env               Path to .env file                             [string]
  -b, --binding           Bind variable/secret (KEY=VALUE)               [array]
      --wasm              WASM module to bind (NAME=PATH)                [array]
```

### Wrangler Configuration

Miniflare uses the default Wrangler configuration keys for most of its features.
For Miniflare specific options, the keys are in the special `[miniflare]`
section.

```toml
kv_namespaces = [                  ## --kv
  { binding = "TEST_NAMESPACE", id = "", preview_id = "" }
]

[durable_objects]
bindings = [                       ## --do
  { name = "OBJECT", class_name = "Object", script_name = "./object.mjs" }
]

[vars]                             ## --binding
KEY = "value"

[site]
bucket = "./public"                ## --site
include = ["upload_dir"]           ## --site-include
exclude = ["ignore_dir"]           ## --site-exclude

[triggers]
crons = ["30 * * * *"]             ## --cron

[build]
command = "npm run build"          ## --build-command
cwd = "build_cwd"                  ## --build-base-path
watch_dir = "build_watch_dir"      ## --build-watch-path
[build.upload]
format = "modules"                 ## --modules
dir = "worker"
main = "./index.mjs"               ## [script]
[[build.upload.rules]]             ## --modules-rule
type = "ESModule"
globs = ["**/*.js"]

[miniflare]
upstream = "https://miniflare.dev" ## --upstream
kv_persist = true                  ## --kv-persist
cache_persist = "./cache"          ## --cache-persist
durable_objects_persist = true     ## --do-persist
env_path = ".env.test"             ## --env
host = "127.0.0.1"                 ## --host
port = 1337                        ## --port
wasm_bindings = [                  ## --wasm
  { name = "MODULE", path="module.wasm" }
]
```
