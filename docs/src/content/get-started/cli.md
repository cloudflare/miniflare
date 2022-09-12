---
order: 0
---

# 💻 Using the CLI

The CLI is the easiest way to get started with Miniflare. It lets you start a
local HTTP server that serves requests using your worker.

<Aside header="Tip">

If you'd like to try out a zero-configuration Workers development experience,
take a look at the [Wrangler 2](https://github.com/cloudflare/wrangler2)
prerelease. It includes a local development mode powered by Miniflare.

</Aside>

## Installation

Miniflare is installed using `npm`:

```sh
$ npm install -g miniflare # either globally...
$ npm install -D miniflare # ...or as a dev dependency
```

You can also install and invoke the CLI using `npx`:

```sh
$ npx miniflare
```

<Aside type="warning" header="Warning">

Miniflare requires at least **Node.js 16.13.0**, as it makes extensive use of
recently added web standards. You should use the latest Node.js version if
possible, as Cloudflare Workers use a very up-to-date version of V8. Consider
using a Node.js version manager such as https://volta.sh/ or
https://github.com/nvm-sh/nvm.

</Aside>

## Usage

If `worker.js` contains the following worker script:

```js
---
filename: worker.js
---
addEventListener("fetch", (event) => {
  event.respondWith(new Response("Hello Miniflare!"));
});
```

...running the following command will start a local HTTP server listening on
port `8787` that responds with `Hello Miniflare!` to all requests:

```sh
$ miniflare worker.js
[mf:inf] Worker reloaded! (97B)
[mf:inf] Listening on :8787
[mf:inf] - http://127.0.0.1:8787
```

Note that the uncompressed size of the worker, `97B`, is logged. Cloudflare
requires all workers are under `1MiB` once compressed. Miniflare will warn you
when your uncompressed size exceeds `1MiB`.

<Aside header="Tip">

If you're building your worker beforehand (with esbuild, Webpack, etc), make
sure you pass the path of your built output to Miniflare, not your input source
code. See [🛠 Builds](/developing/builds) for more details.

If your script is defined in a `wrangler.toml` or `package.json` file, or you're
using Wrangler's `"webpack"` or `"rust"` worker `type`s, you don't need to pass
a script as a command line argument: Miniflare will infer it automatically.

</Aside>

### Watching and Debugging

Add `--watch`/`-w` and `--debug`/`-d` flags to reload the worker whenever
`worker.js` changes and log debug information (including processed options)
respectively:

```sh
$ miniflare worker.js --watch --debug
[mf:dbg] Options:
[mf:dbg] - Script Path: worker.js
[mf:dbg] Enabled Compatibility Flags: <none>
[mf:dbg] Reloading worker.js...
[mf:inf] Worker reloaded! (97B)
[mf:dbg] Watching .env, package.json, worker.js, wrangler.toml...
[mf:inf] Listening on :8787
[mf:inf] - http://127.0.0.1:8787
```

### Configuration Autoloading

Note that `.env`, `package.json` and `wrangler.toml` files are also being
watched. These files are always loaded automatically and configure your worker's
environment in addition to the CLI flags. See the
[Wrangler Configuration](#wrangler-configuration) reference below for more
details, but as an example, with the following `wrangler.toml` file and
`worker.js` files:

```toml
---
filename: wrangler.toml
---
[vars]
KEY = "value"
```

```js
---
filename: worker.js
---
addEventListener("fetch", (event) => {
  event.respondWith(new Response(KEY));
});
```

...the local HTTP server would respond with `value` to all requests. The
[Guide](/core/fetch) goes into more detail on configuring specific features. To
load a different `wrangler.toml` file, use the `--wrangler-config`/`-c` flag:

```sh
$ miniflare worker.js --wrangler-config wrangler.other.toml
```

To change the directory these default files are resolved relative to, use the
`--root` flag:

```sh
$ miniflare api/worker.js --root api
# Miniflare will look for api/.env, api/package.json and api/wrangler.toml
```

### Script Requirement

The only required option is the script to run. This can either be passed as a
command line argument as we've been doing so far, in a `wrangler.toml` file or
in a `package.json` file. The command line argument takes priority, then the
script in `wrangler.toml`, then the `main` or `module` field in `package.json`
(depending on whether `modules` support is enabled):

```toml
---
filename: wrangler.toml
---
[build.upload]
dir = "" # Defaults to "dist"
main = "./worker.js"
```

```json
---
filename: package.json
---
{
  "main": "worker.js", // "service-worker" format
  "module": "worker.mjs" // "modules" format
}
```

### `Request#cf` Object

For a more accurate development experience, Miniflare automatically fetches the
`cf` object for incoming requests (containing IP and location data) from a
trusted Cloudflare endpoint, caching it for 30 days. You can disable this
behaviour, falling back to a default `cf` object, using the `--no-cf-fetch`
flag:

```sh
$ miniflare worker.js --no-cf-fetch
```

### HTTPS Server

By default, Miniflare starts an HTTP server. To start an HTTPS server instead,
set the `https` option. To use an automatically generated self-signed
certificate, use the `--https` flag. This certificate is cached and will be
valid for 30 days. The certificate will be renewed if it expires in less than 2
days:

```sh
$ miniflare worker.js --https # Cache certificate in ./.mf/cert
$ miniflare worker.js --https ./cert_cache # Cache in ./cert_cache instead
```

To use an existing certificate instead, use the `--https-key`, `--https-cert`,
`--https-ca` and `--https-pfx` flags to set the paths to it. If these are
encrypted, use the `--https-passphrase` flag to set the passphrase:

```sh
$ miniflare worker.js --https-key ./key.pem --https-cert ./cert.pem
```

### Opening the Browser

Add the `--open`/`-O` flag to automatically open your default browser to the
worker, once the HTTP server has started:

```sh
$ miniflare worker.js --open # Opens http://localhost:8787
$ miniflare worker.js --open https://example.com # Opens https://example.com
```

### REPL

Add the `--repl` flag to start an interactive REPL session. This behaves exactly
like the [Node.js REPL](https://nodejs.org/api/repl.html#repl), except you have
access to Workers Runtime APIs instead. Any other Miniflare flag can be used
too, with `.env`, `package.json` and `wrangler.toml` files automatically loaded.
Specifying a script is optional when `--repl` is enabled, but may be required if
you're using Durable Objects. If you're using an ES module format worker,
bindings will be accessible via the `env` global variable.

```sh
$ miniflare --repl --kv TEST_NAMESPACE
> await new HTMLRewriter().on("p", {
... element(e) {
..... e.setInnerContent("new");
..... }
... }).transform(new Response("<p>old</p>")).text()
'<p>new</p>'
> await env.TEST_NAMESPACE.put("key", "value")
undefined
> await env.TEST_NAMESPACE.get("key")
'value'
>
```

### Update Checker

The CLI includes an automatic update checker that looks for new versions of
Miniflare once a day. As Cloudflare are always improving and tweaking workers,
you should aim to install these promptly for improved compatibility with the
real Workers environment. You can disable this with the `--no-update-check`
flag.

## Reference

### Flags

```txt
Usage: miniflare [script] [options]

Core Options:
 -h, --help              Show help                                     [boolean]
 -v, --version           Show version number                           [boolean]
 -c, --wrangler-config   Path to wrangler.toml                          [string]
     --wrangler-env      Environment in wrangler.toml to use            [string]
     --package           Path to package.json                           [string]
 -m, --modules           Enable modules                                [boolean]
     --modules-rule      Modules import rule                   [array:TYPE=GLOB]
     --compat-date       Opt into backwards-incompatible changes from   [string]
     --compat-flag       Control specific backwards-incompatible changes [array]
     --usage-model       Usage model (bundled by default)               [string]
 -u, --upstream          URL of upstream origin                         [string]
 -w, --watch             Watch files for changes                       [boolean]
 -d, --debug             Enable debug logging                          [boolean]
 -V, --verbose           Enable verbose logging                        [boolean]
     --(no-)update-check Enable update checker (enabled by default)    [boolean]
     --repl              Enable interactive REPL                       [boolean]
     --root              Path to resolve files relative to              [string]
     --mount             Mount additional named workers  [array:NAME=PATH[@ENV]]
     --name              Name of service                                [string]
     --route             Route to respond with this worker on            [array]
     --global-async-io   Allow async I/O outside handlers              [boolean]
     --global-timers     Allow setting timers outside handlers         [boolean]
     --global-random     Allow secure random generation outside        [boolean]
                         handlers
     --actual-time       Always return correct time from Date methods  [boolean]
     --inaccurate-cpu    Log inaccurate CPU time measurements          [boolean]

HTTP Options:
 -H, --host              Host for HTTP(S) server to listen on           [string]
 -p, --port              Port for HTTP(S) server to listen on           [number]
 -O, --open              Automatically open browser to URL      [boolean/string]
     --https             Enable self-signed HTTPS (with         [boolean/string]
                         optional cert path)
     --https-key         Path to PEM SSL key                            [string]
     --https-cert        Path to PEM SSL cert chain                     [string]
     --https-ca          Path to SSL trusted CA certs                   [string]
     --https-pfx         Path to PFX/PKCS12 SSL key/cert chain          [string]
     --https-passphrase  Passphrase to decrypt SSL files                [string]
     --(no-)cf-fetch     Path for cached Request cf object from [boolean/string]
                         Cloudflare
     --live-reload       Reload HTML pages whenever worker is reloaded [boolean]

Scheduler Options:
 -t, --cron              CRON expression for triggering scheduled events [array]

Build Options:
 -B, --build-command     Command to build project                       [string]
     --build-base-path   Working directory for build command            [string]
     --build-watch-path  Directory to watch for rebuilding on changes    [array]

KV Options:
 -k, --kv                KV namespace to bind                            [array]
     --kv-persist        Persist KV data (to optional path)     [boolean/string]

R2 Options:
 -r, --r2                R2 bucket to bind                               [array]
     --r2-persist        Persist R2 data (to optional path)     [boolean/string]

Durable Objects Options:
 -o, --do                Durable Object to bind       [array:NAME=CLASS[@MOUNT]]
     --do-persist        Persist Durable Object data (to        [boolean/string]
                         optional path)
     --(no-)do-alarms    Enable Durable Object alarms (enabled by      [boolean]
                         default)

Cache Options:
     --(no-)cache        Enable default/named caches (enabled by       [boolean]
                         default)
     --cache-persist     Persist cached data (to optional path) [boolean/string]

Sites Options:
 -s, --site              Path to serve Workers Site files from          [string]
     --site-include      Glob pattern of site files to serve             [array]
     --site-exclude      Glob pattern of site files not to serve         [array]

Bindings Options:
 -e, --env               Path to .env file                              [string]
 -b, --binding           Binds variable/secret to environment  [array:KEY=VALUE]
     --global            Binds variable/secret to global scope [array:KEY=VALUE]
     --wasm              WASM module to bind                   [array:NAME=PATH]
     --text-blob         Text blob to bind                     [array:NAME=PATH]
     --data-blob         Data blob to bind                     [array:NAME=PATH]
 -S, --service           Mounted service to bind        [array:NAME=MOUNT[@ENV]]
```

### Wrangler Configuration

Miniflare uses the default Wrangler configuration keys for most of its features.
For Miniflare specific options, the keys are in the special `[miniflare]`
section.

```toml
---
filename: wrangler.toml
---
name = "worker"                    # --name

compatibility_date = "2021-11-12"  # --compat-date
compatibility_flags = [            # --compat-flag
    "formdata_parser_supports_files"
]

kv_namespaces = [                  # --kv
  { binding = "TEST_NAMESPACE", id = "", preview_id = "" }
]

r2_buckets = [                     # --r2
  { binding = "BUCKET", bucket_name = "" }
]

[durable_objects]
bindings = [                       # --do
  { name = "OBJECT", class_name = "Object" }
]

[vars]                             # --binding
KEY = "value"

[site]
bucket = "./public"                # --site
include = ["upload_dir"]           # --site-include
exclude = ["ignore_dir"]           # --site-exclude

[triggers]
crons = ["30 * * * *"]             # --cron

[build]
command = "npm run build"          # --build-command
cwd = "build_cwd"                  # --build-base-path
watch_dir = "build_watch_dir"      # --build-watch-path
[build.upload]
format = "modules"                 # --modules
dir = "worker"
main = "./index.mjs"               # [script]
[[build.upload.rules]]             # --modules-rule
type = "ESModule"
globs = ["**/*.js"]

[wasm_modules]                     # --wasm
MODULE = "module.wasm"
[text_blobs]                       # --text-blob
TEXT = "text.txt"
[data_blobs]                       # --data-blob
DATA = "data.bin"

[miniflare]
host = "127.0.0.1"                 # --host
port = 1337                        # --port
upstream = "https://miniflare.dev" # --upstream
watch = true                       # --watch
live_reload = true                 # --live-reload
env_path = ".env.test"             # --env
kv_persist = true                  # --kv-persist
r2_persist = true                  # --r2-persist
cache_persist = "./cache"          # --cache-persist
cache = false                      # --no-cache
durable_objects_persist = true     # --do-persist
durable_objects_alarms = false     # --no-do-alarms
update_check = false               # --no-update-check
cf_fetch = "./cf.json"             # --cf-fetch ./cf.json
cf_fetch = false                   # --no-cf-fetch
https = true                       # --https
https = "./cert_cache"             # --https ./cert_cache
actual_time = true                 # --actual-time
global_async_io = true             # --global-async-io
global_timers = true               # --global-timers
global_random = true               # --global-random
actual_time = true                 # --actual-time
inaccurate_cpu = true              # --inaccurate-cpu
[miniflare.https]
key = "./key.pem"                  # --https-key
cert = "./cert.pem"                # --https-cert
ca = "./ca.pem"                    # --https-ca
pfx = "./pfx.pfx"                  # --https-pfx
passphrase = "pfx passphrase"      # --https-passphrase
[miniflare.globals]                # --global
KEY = "value"
[miniflare.mounts]                 # --mount
api = "./api"
```
