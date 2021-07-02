# 🔥 Miniflare

Fun, full-featured, fully-local simulator for developing and testing Cloudflare
Workers

**See <https://miniflare.pages.dev> for many more details.**

## Features

- 📨 Fetch Events (with HTTP server and manual triggering)
- ⏰ Scheduled Events (with manual and cron triggering)
- 🔑 Variables and Secrets with `.env` Files
- 📚 Modules Support
- 📦 KV (with optional persistence)
- ✨ Cache (with optional persistence)
- 📌 Durable Objects (with optional persistence)
- 🌐 Workers Sites
- ✉️ WebSockets
- 🛠 Custom & Wrangler Builds Support
- ⚙️ WebAssembly Support
- 🗺 Source Map Support
- 🕸 Web Standards: Base64, Timers, Fetch, Encoding, URL, Streams, Crypto
- 📄 HTMLRewriter
- 👀 Automatic Reload on File Changes
- 💪 Written in TypeScript

## Install

Miniflare is installed using npm:

```shell
$ npm install -g miniflare # either globally..
$ npm install -D miniflare # ...or as a dev dependency
```

## Using the CLI

```shell
$ miniflare worker.js --watch --debug
[mf:dbg] Options:
[mf:dbg] - Scripts: worker.js
[mf:dbg] Reloading worker.js...
[mf:inf] Worker reloaded!
[mf:dbg] Watching .env, worker.js, wrangler.toml...
[mf:inf] Listening on :8787
[mf:inf] - http://127.0.0.1:8787
```

## Using the API

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response("Hello Miniflare!"));
  });
  `,
});
const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
```

## CLI Reference

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

## Acknowledgements

Many thanks to
[dollarshaveclub/cloudworker](https://github.com/dollarshaveclub/cloudworker)
and
[gja/cloudflare-worker-local](https://github.com/gja/cloudflare-worker-local)
for inspiration.
