---
order: 3
---

# ⬆️ Migrating from Version 1

Miniflare 2 includes [breaking changes](/get-started/changelog#_2-0-0). This
guide walks you through how to upgrade your app.

## CLI & API Changes

### Upgrade Node.js

**Node.js 16.7.0 is now the minimum required version**. You should use the
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
