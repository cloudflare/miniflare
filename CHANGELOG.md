# 🚧 Changelog

## 1.3.0

### Features

- Switched to a [`lol-html`](https://github.com/cloudflare/lol-html)-based
  WebAssembly implementation of `HTMLRewriter` for a more accurate simulation of
  the real Workers environment. See
  [📄 HTMLRewriter](https://miniflare.dev/html-rewriter.html) for more details.
- Added HTTPS support for local development, thanks
  [@RichiCoder1](https://github.com/RichiCoder1) for the
  [suggestion (#12)](https://github.com/mrbbot/miniflare/issues/12). See
  [💻 Using the CLI](https://miniflare.dev/cli.html#https-server) and
  [🧰 Using the API](https://miniflare.dev/api.html#https-server) for more
  details.
- When using the CLI, the `--watch` flag is now assumed if `--build-watch-path`
  is set, thanks [@evanderkoogh](https://github.com/evanderkoogh) for the
  [PR (#8)](https://github.com/mrbbot/miniflare/pull/8)

### Fixes

- Switched to real values for the `cf` property, thanks
  [@chase](https://github.com/chase) for the
  [PR (#11)](https://github.com/mrbbot/miniflare/pull/11)
- Upgraded the TOML parser to support dotted keys, thanks
  [@leader22](https://github.com/leader22) for the
  [PR (#13)](https://github.com/mrbbot/miniflare/pull/13)

## 1.2.0

### Features

- Added **Redis** persistence support for
  [📦 KV](https://miniflare.dev/kv.html#persistence),
  [✨ Cache](https://miniflare.dev/cache.html#persistence) and
  [📌 Durable Objects](https://miniflare.dev/durable-objects.html#persistence)
- Added support for loading scripts from `package.json`, closes
  [issue #7](https://github.com/mrbbot/miniflare/issues/7). See
  [💻 Using the CLI](https://miniflare.dev/cli.html#script-requirement) and
  [⚡️ Developing with esbuild](https://miniflare.dev/recipes/esbuild.html#dependencies)
  for more details.
- Added `FormData` to the sandbox, closes
  [issue #6](https://github.com/mrbbot/miniflare/issues/6)
- Added an automatic update checker. See
  [💻 Using the CLI](https://miniflare.dev/cli.html#update-checker) for more
  details.
- [📚 Modules](https://miniflare.dev/modules.html) mode is now always enabled
  when specifying
  [📌 Durable Objects](https://miniflare.dev/durable-objects.html##objects)
  bindings

### Fixes

- Fixed **Windows** support, closes
  [issue #10](https://github.com/mrbbot/miniflare/issues/10)
- Fixed issue where scripts were not reloaded correctly when editing script path
  in `wrangler.toml`. Scripts are now always reloaded on options change.
  `Miniflare.reloadScript()` is now deprecated. You should use
  `Miniflare.reloadOptions()` instead.

## 1.1.0

### Features

- Added support for namespaced caches with `caches.open`. See
  [✨ Cache](https://miniflare.dev/cache.html) for more details.

## 1.0.1

### Fixes

- Fixed
  `/usr/bin/env: 'node --experimental-vm-modules': No such file or directory`
  error when running the CLI in Linux. See
  [💻 Using the CLI](https://miniflare.dev/cli.html#usage) for more details.

## 1.0.0

### Breaking Changes

- The first and only argument to the `Miniflare` constructor is now an object.
  Scripts should be specified via the `script` option for strings and the
  `scriptPath` option for files:

  ```js
  // Previous version
  import vm from "vm";
  import { Miniflare } from "miniflare";

  const mf1 = new Miniflare(
    new vm.Script(`addEventListener("fetch", (event) => { ... })`),
    { kvPersist: true }
  );
  const mf2 = new Miniflare("script.js", { kvPersist: true });
  ```

  ```js
  // New version
  import { Miniflare } from "miniflare";

  const mf1 = new Miniflare({
    script: `addEventListener("fetch", (event) => { ... })`,
    kvPersist: true,
  });
  const mf2 = new Miniflare({
    scriptPath: "script.js",
    kvPersist: true,
  });
  ```

- The `Miniflare.getNamespace` method has been renamed to
  `Miniflare.getKVNamespace`
- Logged errors will now throw a `MiniflareError` if no log is provided
- When using file system KV persistence, key names are now sanitised to replace
  special characters such as `:`, `/`, and `\`. Reading keys containing these
  characters may now return `null` if a value was stored in the previous
  version.

### Features

- Added support for [📚 Modules](https://miniflare.dev/modules.html) (requires
  `--experimental-vm-modules` flag)
- Added support for
  [📌 Durable Objects](https://miniflare.dev/durable-objects.html)
- Added support for [✉️ Web Sockets](https://miniflare.dev/web-sockets.html)
  (client and server)
- Added support for [🛠 Builds](https://miniflare.dev/builds.html) (custom builds
  and `webpack`/`rust` Wrangler builds)
- Added support for [⚙️ WebAssembly](https://miniflare.dev/web-assembly.html)
- Added support for [📄 HTMLRewriter](https://miniflare.dev/html-rewriter.html)
- Made CLI `script` parameter optional, it can now be inferred in some cases
  from `wrangler.toml`
- Added `host` option (`--host`/`-H` flag) for restricting hosts the HTTP server
  listens on
- Added `Miniflare.dispose` method for cleaning up file watcher
- Added
  [`CF-*` headers](https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-)
  and
  [`cf` object](https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties)
  to HTTP server requests
- Added `cron` property to
  [⏰ Scheduled Events](https://miniflare.dev/scheduled.html)
- Added manual triggering for
  [⏰ Scheduled Events](https://miniflare.dev/scheduled.html) via
  `/.mf/scheduled` HTTP endpoint
- Added pretty error page powered by [Youch](https://github.com/poppinss/youch)
- Added many more tests

### Fixes

- Fixed error if options object (containing `type` and `cacheTtl` properties)
  passed as second parameter to KV `get` method, closes
  [issue #3](https://github.com/mrbbot/miniflare/issues/3)
- Fixed error if `ArrayBuffer` passed as `data` to
  `crypto.subtle.digest("md5", data)`
- Fixed handling of `ignoreMethod` option for `Cache` `match` and `delete`
- Disabled edge caching when using Workers Sites, files are now always loaded
  from disk
- Provided `Set` and `WeakSet` from Miniflare's realm to sandbox, removing
  `Promise`, so `(async () => {})() instanceof Promise` evaluates to `true`

## 0.1.1

### Fixes

- Depend on `@mrbbot/node-fetch` from npm instead of GitHub, closes
  [issue #2](https://github.com/mrbbot/miniflare/issues/2)

## 0.1.0

Initial Release

### Features

- Added support for [📨 Fetch Events](https://miniflare.dev/fetch.html)
- Added support for [⏰ Scheduled Events](https://miniflare.dev/scheduled.html)
- Added support for
  [🔑 Variables and Secrets](https://miniflare.dev/variables-secrets.html)
- Added support for [📦 KV](https://miniflare.dev/kv.html)
- Added support for [✨ Cache](https://miniflare.dev/cache.html)
- Added support for [🌐 Workers Sites](https://miniflare.dev/sites.html)
- Added support for [🗺 Source Maps](https://miniflare.dev/source-maps.html)
