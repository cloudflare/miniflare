# 🚧 Changelog

## 1.0.1

- Fix
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
- Provide `Set` and `WeakSet` from Miniflare's realm to sandbox, removing
  `Promise`, so `(async () => {})() instanceof Promise` evaluates to `true`

## 0.1.1

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
