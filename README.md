# 🔥 Miniflare (WIP)

Fun, fully-local Cloudflare Workers simulator for developing and testing Workers

## Features

- 📦 KV (with optional persistence)
- ✨ Cache (with optional persistence)
- 🌐 Workers Sites
- 📨 Fetch Events (with HTTP server and manual triggering)
- ⏰ Scheduled Events (with manual and cron triggering)
- 🔑 `.env` File Support (for secrets)
- 🗺 Source Map Support
- 👀 Automatic Reload on File Changes
- 💪 Written in TypeScript

## Coming Soon

- 📌 Durable Objects
- ✉️ WebSockets
- 📄 HTMLRewriter
- 🛠 Custom Builds Support 
- ⚙️ WebAssembly Support
- 🤹 Custom [Jest Environment](https://jestjs.io/docs/configuration#testenvironment-string)
- ✅ More Tests

## CLI Usage

```
Usage: miniflare <script> [options]

Options:
  -h, --help             Show help                                     [boolean]
  -v, --version          Show version number                           [boolean]
  -p, --port             HTTP server port (8787 by default)             [number]
  -d, --debug            Log debug messages                            [boolean]
  -c, --wrangler-config  Path to wrangler.toml                          [string]
      --wrangler-env     Environment in wrangler.toml to use            [string]
  -w, --watch            Watch files for changes                       [boolean]
  -u, --upstream         URL of upstream origin                         [string]
  -t, --cron             Cron pattern to trigger scheduled events with   [array]
  -k, --kv               KV namespace to bind                            [array]
      --kv-persist       Path to persist KV data to (omit path for default)
      --cache-persist    Path to persist cached data to (omit path for default)
  -s, --site             Path to serve Workers Site files from          [string]
      --site-include     Glob pattern of site files to serve             [array]
      --site-exclude     Glob pattern of site files not to serve         [array]
  -e, --env              Path to .env file                              [string]
  -b, --binding          Bind variable/secret (KEY=VALUE)                [array]
```

`<script>` should be a path to a pre-bundled Worker.
If you're using Webpack for instance, set this to your output file.

Use `--debug`/`-d` to see additional log messages including processed options and watched files. **(recommended)**

Use `--wrangler-config <toml_path>`/`-c <toml_path>` to load options for KV, cache, etc from a `wrangler.toml` file. **(recommended)**
You can also include an additional `[miniflare]` section for Miniflare specific configuration:

```toml
[miniflare]
upstream = "https://mrbbot.dev" # --upstream
kv_persist = true               # --kv-persist
cache_persist = true            # --cache-persist
env_path = ".env"               # --env
port = 8787                     # --port
```

KV and cache persistence can be enabled with the `--kv-persist` and `--cache-persist` flags respectively.
Including these on their own will store KV and Cache data in the `.mf` directory.
Optionally, you can specify a path (e.g. `--kv-persist ./data`) to use a different location.

## Programmatic Usage

```javascript
import vm from "vm";
import { ConsoleLog, Miniflare, Request } from "miniflare";

// Loading script from file
const mf = new Miniflare("./path/to/script.js", {
  // Some options omitted, see src/options/index.ts for the full list
  sourceMap: true,
  log: new ConsoleLog(), // Defaults to no-op logger
  wranglerConfigPath: "wrangler.toml",
  watch: true,
  port: 8787,
  upstream: "https://mrbbot.dev",
  crons: ["0 * * * *"],
  kvNamespaces: ["TEST_NAMESPACE"],
  kvPersist: true,
  cachePersist: "./data/",
  sitePath: "./public/",
  envPath: ".env",
});

// Loading script from string
const mf = new Miniflare(
  new vm.Script(`
      addEventListener("fetch", (event) => {
        event.respondWith(handleRequest(event.request));
        event.waitUntil(Promise.resolve("Something"));
      });
      
      async function handleRequest(request) {
        const value = await TEST_NAMESPACE.get("key");
        return new Response(\`Hello from Miniflare! key="\${value}"\`, {
          headers: { "content-type": "text/plain" },
        })
      }
      
      addEventListener("scheduled", (event) => {
        event.waitUntil(Promise.resolve("Something else"));
      });
    `),
  {
    kvNamespaces: ["TEST_NAMESPACE"],
    log: new ConsoleLog(),
  }
);

// Manipulate KV outside of worker (useful for testing)
const ns = await mf.getNamespace("TEST_NAMESPACE");
await ns.put("key", "testing");

// Manipulate cache outside of worker
const cache = await mf.getCache();
const cachedRes = await cache.match(new Request("http://localhost"));

// Dispatch fetch events and get body
const res = await mf.dispatchFetch(new Request("http://localhost"));

const body = await res.text();
console.log(body); // Hello from Miniflare! key="testing"

const waitUntil = await res.waitUntil();
console.log(waitUntil[0]); // Something

// Start HTTP server
mf.createServer().listen(3000);

// Dispatch scheduled event at specific time
const waitUntil2 = await mf.dispatchScheduled(Date.now());
console.log(waitUntil2[0]); // Something else
```

## Acknowledgements

Many thanks to [dollarshaveclub/cloudworker](https://github.com/dollarshaveclub/cloudworker) and [gja/cloudflare-worker-local](https://github.com/gja/cloudflare-worker-local) for inspiration.
