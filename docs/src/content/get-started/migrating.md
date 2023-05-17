---
order: 3
---

# ⬆️ Migrating from Version 2

Refer to
[the Miniflare and workerd blog post](https://blog.cloudflare.com/miniflare-and-workerd/)
for the Miniflare v3 announcement.

## Missing Features

Several features from Miniflare v2 are not supported in Miniflare v3's initial
release. However, they are on the roadmap, and will be added soon:

- Step-through debugging
- Automatically triggering scheduled events via CRON schedules, or manually
  triggering them via `/.mf/scheduled` or `/cdn-cgi/mf/scheduled` (manually
  triggering events is supported via the `--test-scheduled` Wrangler flag and
  visiting `/__scheduled`)
- Starting an HTTPS server

## CLI Changes

Miniflare v3 no longer includes a standalone CLI. To get the same functionality,
you will need to switch over to using
[Wrangler](https://developers.cloudflare.com/workers/wrangler/). Wrangler v3
uses Miniflare v3 by default. To use Wrangler, run:

```sh
$ npx wrangler@3 dev
```

If there are features from the Miniflare CLI you would like to see in Wrangler,
please open an issue on
[GitHub](https://github.com/cloudflare/workers-sdk/issues/new/choose).

## API Changes

We have tried to keep Miniflare v3’s API close to Miniflare v2 where possible,
but many options and methods have been removed or changed with the switch to the
open-source `workerd` runtime. See the
[GitHub `README` for the new API docs](https://github.com/cloudflare/miniflare/blob/tre/packages/miniflare/README.md).

### Changed Options

#### `bindings`

Values passed to the `bindings` option must now be JSON-serialisable. Consider
using the `serviceBindings` option if you need to bind custom functions.

### Removed Options

#### `wranglerConfigPath` and `wranglerConfigEnv`

Miniflare no longer handles Wrangler’s configuration. To programmatically start
up a Worker with Wrangler configuration, use the
[`unstable_dev()`](https://developers.cloudflare.com/workers/wrangler/api/#unstable_dev)
API.

#### `packagePath`

Specify your script using the `scriptPath` option instead.

#### `upstream`

Always pass the full upstream URL when calling `dispatchFetch()`.

#### `watch`

Miniflare’s API is primarily intended for testing use cases, where file watching
isn’t too important. This option was here to enable Miniflare’s CLI which has
now been removed. If you need to watch files, consider using a separate file
watcher and calling `setOptions()` with your original config on change.

#### `logUnhandledRejections`

Unhandled rejections can be handled in Workers with
[`addEventListener("unhandledrejection")`](https://community.cloudflare.com/t/2021-10-21-workers-runtime-release-notes/318571)

#### `globalAsyncIO`, `globalTimers`, `globalRandom`, and `inaccurateCpu`

These options are not supported by
[`workerd`](https://github.com/cloudflare/workerd), the open source Cloudflare
Workers runtime, and so can't be supported in Miniflare.

#### `actualTime`

Miniflare will always return the current time.

#### `https`, `httpsKey`, `httpsKeyPath`, `httpsCert`, `httpsCertPath`, `httpsPfx`, `httpsPfxPath`, and `httpsPassphrase`

Miniflare does not currently support starting HTTPS servers. These options may
be added back in a future release.

#### `metaProvider`

The `cf` object and `X-Forwarded-Proto`/`X-Real-IP` headers can be specified
when calling `dispatchFetch()` instead

#### `cFetch`

Renamed to `cf`.

#### `crons`

This is not currently supported by
[`workerd`](https://github.com/cloudflare/workerd), the open source Cloudflare
Workers runtime, but will be in a future release.

#### `durableObjectAlarms`

Durable Object alarms are always enabled in Miniflare v3.

#### `globals`

`globals` is not supported by
[`workerd`](https://github.com/cloudflare/workerd), the open source Cloudflare
Workers runtime.

#### `mounts`

Miniflare v3 does not have the concept of parent/child Workers. Instead, all
Workers are at the same level. The same functionality can be achieved using the
`workers` option. Note some options are always top-level, and some options are
per-Worker.

### Changed Methods

#### `setOptions()`

Calling `setOptions()` now requires a full configuration object, not a partial
patch.

### Removed Methods

#### `reload()`

Call `setOptions()` with the original configuration object instead.

#### `getMount()`

Miniflare v3 does not have the concept of parent/child Workers. Instead, all
Workers are at the same level. Refer to the
[`3.0.0-next.1` release notes](https://github.com/cloudflare/miniflare/releases/tag/v3.0.0-next.1)
for an example multi-Worker configuration.

#### `createServer()` and `startServer()`

These methods are now redundant. Miniflare v3 always starts an HTTP server.

#### `startScheduled()` and `dispatchScheduled()`

[`workerd`](https://github.com/cloudflare/workerd) does not support triggering
scheduled events yet, but will in an upcoming release.

#### `dispatchQueue()`

Use the `queue()` method on
[service bindings](https://developers.cloudflare.com/workers/platform/bindings/about-service-bindings/)
or
[queue producer bindings](https://developers.cloudflare.com/queues/platform/configuration/#producer).

#### `Response#waitUntil()`

[`workerd`](https://github.com/cloudflare/workerd) does not support waiting for
all `waitUntil()`ed promises yet.

#### `getGlobalScope()`, `getBindings()`, `getModuleExports()`, `getKVNamespace()`, `getR2Bucket()`, `getCaches()`, and `getDurableObjectNamespace()`

These methods returned objects from inside the Workers sandbox. Since Miniflare
now uses [`workerd`](https://github.com/cloudflare/workerd), which runs in a
different process, these methods can no longer be supported.

# ⬆️ Migrating from Version 1

Miniflare 2 includes [breaking changes](/get-started/changelog#_2-0-0). This
guide walks you through how to upgrade your app.

## CLI & API Changes

### Upgrade Node.js

**Node.js 16.13.0 is now the minimum required version**. You should use the
latest Node.js version if possible, as Cloudflare Workers use a very up-to-date
version of V8. Consider using a Node.js version manager such as
<https://volta.sh/> or <https://github.com/nvm-sh/nvm>.

### Delete persisted Durable Object and cached data

The storage format for Durable Objects and cached responses has changed in
Miniflare 2. If you were persisting to the file-system or Redis, you'll need to
delete these directories/namespaces.

### Delete references to Durable Object IDs

The format for Durable Object IDs has changed in Miniflare 2 to include a hash
of the object name. If you have any these stored in persisted KV data or
constants, you'll need to delete them.

### Replace `--disable-updater` with `--no-update-check`

The `--disable-updater` flag has been renamed to `--no-update-check`.

### Replace `--disable-cache` with `--no-cache`

The `--disable-cache` flag has been renamed to `--no-cache`. The `disableCache`
API option has also been replaced with `cache`. Replace...

```js
const mf = new Miniflare({ disableCache: true }); // ❌
```

...with...

```js
const mf = new Miniflare({ cache: false }); // ✅
```

### Replace `miniflare.wasm_bindings` with `wasm_modules`

The `miniflare.wasm_bindings` key was non-standard. It has been replaced with
the standard `wasm_modules` key. Replace...

```toml
---
filename: wrangler.toml
---
[miniflare]
wasm_bindings = [ # ❌
  { name = "MODULE1", path="module1.wasm" },
  { name = "MODULE2", path="module2.wasm" }
]
```

...with...

```toml
---
filename: wrangler.toml
---
[wasm_modules] # ✅
MODULE1 = "module1.wasm"
MODULE2 = "module2.wasm"
```

### Update the `script_name` option

The Durable Object `script_name` option was implemented incorrectly in
Miniflare 1. It should've been the name of a worker, not a path to a script.
Replace...

```toml
---
filename: wrangler.toml
---
[durable_objects]
bindings = [
  { name = "TEST", class_name = "Test", script_name = "./api/index.mjs" }, # ❌
]
```

```js
const mf = new Miniflare({
  durableObjects: {
    TEST: { className: "Test", scriptPath: "./api/index.mjs" }, // ❌
  },
});
```

...with...

```toml
---
filename: wrangler.toml
---
[durable_objects]
bindings = [
  { name = "TEST", class_name = "Test", script_name = "api" }, # ✅
]
[miniflare.mounts]
api = "./api"
```

```js
const mf = new Miniflare({
  durableObjects: {
    TEST: { className: "Test", scriptName: "api" }, // ✅
  },
  mounts: { api: "./api" },
});
```

See
[📌 Durable Objects](/storage/durable-objects#using-a-class-exported-by-another-script)
for more details.

### Install the optional `@miniflare/storage-redis` package

Redis persistence support is no longer included by default. If you're persisting
KV, Durable Objects or cached data in Redis, you must install the
`@miniflare/storage-redis` optional peer dependency:

```sh
$ npm install @miniflare/storage-redis -D
```

## API Only Changes

### Automatically load configuration files

When using the API, `wrangler.toml`, `package.json` and `.env` are **no longer
automatically loaded from their default locations**. To re-enable this
behaviour, set these options to `true`:

```js
const mf = new Miniflare({
  wranglerConfigPath: true, // ✅
  packagePath: true,
  envPath: true,
});
```

### Replace `ConsoleLog` with `Log`

The `ConsoleLog` class has been replaced with the `Log` class. You can construct
this with a `LogLevel` to control how much information is logged to the console.
Replace...

```js
import { Miniflare, ConsoleLog } from "miniflare";
const mf = new Miniflare({
  log: new ConsoleLog(true), // ❌
});
```

...with...

```js
import { Miniflare, Log, LogLevel } from "miniflare";
const mf = new Miniflare({
  log: new Log(LogLevel.DEBUG), // ✅
});
```

### Replace `storage()` with `getDurableObjectStorage()`

The `DurableObjectStub#storage()` method was non-standard, and was accessible
inside workers, which was not good. It has been replaced with the
`Miniflare#getDurableObjectStorage()` method. Replace...

```js
---
highlight: [4,5]
---
const mf = new Miniflare({ ... });
const ns = await mf.getDurableObjectNamespace("TEST");
const id = ns.newUniqueId();
const stub = ns.get(id);
const storage = await stub.storage(); // ❌
```

...with...

```js
---
highlight: [4]
---
const mf = new Miniflare({ ... });
const ns = await mf.getDurableObjectNamespace("TEST");
const id = ns.newUniqueId();
const storage = await mf.getDurableObjectStorage(id); // ✅
```

### Replace `getCache()` with `getCaches()`

The `Miniflare#getCache()` method has been replaced with
`Miniflare#getCaches()`. Replace...

```js
const mf = new Miniflare({ ... });
const defaultCache = await mf.getCache(); // ❌
const namedCache = await mf.getCache("named"); // ❌
```

...with...

```js
const mf = new Miniflare({ ... });
const caches = await mf.getCaches();
const defaultCache = caches.default; // ✅
const namedCache = await caches.open("named"); // ✅
```

### Replace `buildWatchPath` with `buildWatchPaths`

Miniflare 2 supports watching multiple paths for changes to rebuild on.
Replace...

```js
const mf = new Miniflare({
  buildWatchPath: "./src", // ❌
});
```

...with...

```js
const mf = new Miniflare({
  buildWatchPaths: ["./src"], // ✅
});
```

### Replace `reloadOptions()` with `reload()`

The `Miniflare#reloadOptions()` method has been replaced with
`Miniflare#reload()`. Replace...

```js
const mf = new Miniflare({ ... });
await mf.reloadOptions(); // ❌
```

...with...

```js
const mf = new Miniflare({ ... });
await mf.reload(); // ✅
```

Miniflare 2 also adds a new `Miniflare#setOptions()` method which accepts the
same options object as the `new Miniflare` constructor, applies those options,
then reloads the worker.

```js
const mf = new Miniflare({
  buildCommand: "npm run build",
  kvNamespaces: ["TEST"],
});
await mf.setOptions({
  kvNamespaces: ["TEST2"], // ✅
});
```

### Await `createServer()`

The `Miniflare#createServer()` method now always returns a `Promise`. Replace...

```js
const mf = new Miniflare({ ... });
const server = mf.createServer(); // ❌
server.listen(5000, () => { ... });
```

...with...

```js
const mf = new Miniflare({ ... });
const server = await mf.createServer(); // ✅
server.listen(5000, () => { ... });
```

Miniflare 2 also adds a new `Miniflare#startServer()` which automatically starts
a server using the configured `host` and `port`.

```js
const mf = new Miniflare({ port: 5000 });
await mf.startServer(); // ✅
```
