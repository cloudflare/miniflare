# 🚧 Changelog

## 2.0.0-next.2

### Fixes

- Added support for the
  [`Response#encodeBody` property](https://developers.cloudflare.com/workers/runtime-apis/response#properties).
  If this is omitted or set to `auto`, `Response`s with a `Content-Encoding`
  header that includes `gzip`, `deflate` or `br` will be automatically encoded.
  Closes [issue #72](https://github.com/cloudflare/miniflare/issues/72), thanks
  [@SupremeTechnopriest](https://github.com/SupremeTechnopriest).
- Getters on `Request`/`Response` are now enumerable, and headers added to
  `Request`/`Response` instances after construction will now be retained if
  those instances are used to construct new `Request`/`Response`s. Closes
  [issue #73](https://github.com/cloudflare/miniflare/issues/73), thanks
  [@maraisr](https://github.com/maraisr) and
  [@somebody1234](https://github.com/somebody1234).
- Variables defined in `.env` files now override those in `wrangler.toml`.
  Closes [issue #75](https://github.com/cloudflare/miniflare/issues/75), thanks
  [@payellodevsupport](https://github.com/payellodevsupport) for the
  [PR](https://github.com/cloudflare/miniflare/pull/76).
- `http` and `https` protocols are now required for WebSocket upgrades via
  `fetch` as per the workers runtime
- Miniflare-added `CF-*` headers are now included in the HTML error response

## 2.0.0-next.1

Miniflare 2 has been completely redesigned from version 1 with 3 primary design
goals:

1. 📚 **Modular:** Miniflare 2 splits Workers components (KV, Durable Objects,
   etc.) into **separate packages** (`@miniflare/kv`,
   `@miniflare/durable-objects`, etc.) that you can import separately for
   testing.
2. ✨ **Lightweight:** Miniflare 1 included
   [122 third-party packages](http://npm.anvaka.com/#/view/2d/miniflare) with a
   total install size of `88.3MB`. Miniflare 2 reduces this to **24 packages and
   `11.5MB`** 🤯. This can probably be reduced further too.
3. ✅ **Correct:** Miniflare 2 more accurately replicates the quirks and thrown
   errors of the real Workers runtime, so you'll know before you deploy if
   things are going to break.

The docs will be updated over the next few weeks.

### Notable Changes

- ✳️ Node.js 16.7.0 is now the minimum required version
- 🎲 Added support for `crypto.randomUUID()`
- 🔐 Added support for the `NODE-ED25519` algorithm
- 📅 Added support for compatibility dates and flags:
  `durable_object_fetch_requires_full_url`, `fetch_refuses_unknown_protocols`,
  `formdata_parser_supports_files`
- 📚 Added a proper CommonJS module loader
- 🚪 Added Durable Object input and output gates, and write coalescing
- 🛑 Added the `DurableObjectState#blockConcurrencyWhile(callback)` method
- ⚡️ Added a live reload feature (`--live-reload`) that automatically refreshes
  your browser when your worker reloads
- 🗺 Automatically fetch the incoming `Request#cf` object from a trusted
  Cloudflare endpoint
- ✉️ Added support for sending/receiving binary WebSocket messages

### Breaking Changes

- **Node.js 16.7.0 is now the minimum required version.** You should use the
  latest Node.js version if possible, as Cloudflare Workers use a very
  up-to-date version of V8. Consider using a Node.js version manager such as
  <https://volta.sh/> or <https://github.com/nvm-sh/nvm>.
- Changed the storage format for Durable Objects and cached responses. If you're
  using file-system or Redis storage, you'll need to delete these
  directories/namespaces.
- Changed the Durable Object ID format to include a hash of the object name.
  Durable Object IDs generated in Miniflare 1 cannot be used with Miniflare 2.
- Removed support for the Durable Object `script_name` option. This was
  implemented incorrectly in Miniflare 1. It will be re-implemented correctly
  soon.
- Removed the non-standard `DurableObjectStub#storage()` method. To access
  Durable Object storage outside a worker, use the new
  `Miniflare#getDurableObjectStorage(id)` method, passing a `DurableObjectId`
  obtained from a stub.
- Renamed the `--disable-cache`/`disableCache: true` option to
  `--no-cache`/`cache: false`
- Renamed the `--disable-updater` option to `--no-update-check`
- When using the API, `wrangler.toml`, `package.json` and `.env` are now no
  longer automatically loaded from their default locations. To re-enable this
  behaviour, set these options to `true`:

  ```js
  const mf = new Miniflare({
    wranglerConfigPath: true,
    packagePath: true,
    envPath: true,
  });
  ```

- Replaced the `ConsoleLog` class with the `Log` class from `@miniflare/shared`.
  You can construct this with a member from the `LogLevel` `enum` to control how
  much information is logged to the console:

  ```js
  import { Miniflare } from "miniflare";
  import { Log, LogLevel } from "@miniflare/shared";

  const mf = new Miniflare({
    log: new Log(LogLevel.DEBUG),
  });
  ```

- Load WASM bindings from the standard `wasm_modules` `wrangler.toml` key
  instead of `miniflare.wasm_bindings`.

  ```toml
  # wrangler.toml
  [miniflare]
  wasm_bindings = [
    { name = "MODULE1", path="module1.wasm" },
    { name = "MODULE2", path="module2.wasm" }
  ]
  ```

  ...should now be...

  ```toml
  # wrangler.toml
  [wasm_modules]
  MODULE1 = "module1.wasm"
  MODULE2 = "module2.wasm"
  ```

- Replaced the `Miniflare#reloadOptions()` method with the `Miniflare#reload()`
  and `Miniflare#setOptions({ ... })` methods. `reload()` will reload options
  from `wrangler.toml` (useful if not watching), and `setOptions()` accepts the
  same options object as the `new Miniflare` constructor, applies those options,
  then reloads the worker.
- `Miniflare#createServer()` now always returns a `Promise` which you must await
  to get a `http.Server`/`https.Server` instance. You may want to check out the
  new `Miniflare#startServer()` method which automatically starts a server using
  the configured `host` and `port`.
- Miniflare no longer includes CommonJS exports. You must use ES modules. If you
  need to import `miniflare` in a CommonJS file, use dynamic import:
  `const { Miniflare } = await import("miniflare")`.
- Redis support is no longer included by default. If you're persisting KV,
  Durable Objects or cached responses in Redis, you must install the
  `@miniflare/storage-redis` optional peer dependency.
- Replaced how Miniflare sanitises file paths for file-system storage so
  namespace separators (`/`, `\`, `:` and `|`) now create new directories.

### Features and Fixes

**Cache:**

- Added support for `cf.cacheKey`, `cf.cacheTtl` and `cf.cacheTtlByStatus` on
  `Request`. Closes
  [issue #37](https://github.com/cloudflare/miniflare/issues/37), thanks
  [@cdloh](https://github.com/cdloh).
- Added the `CF-Cache-Status: HIT` header to matched `Response`s
- Log warning when trying to use cache with `workers_dev = true` in
  `wrangler.toml`. Cache operations are a no-op on `workers.dev` subdomains.
- Throw errors when trying to cache Web Socket, non-`GET`,
  `206 Partial Content`, or `Vary: *` responses
- Throw an error when trying to `open` a cache with a name longer than `1024`
  characters

**CLI:**

- Separated command line options into sections
- Validate types of all command line options

**Builds:**

- When running your worker's build script, Miniflare will set the environment
  variable `MINIFLARE=1`. Closes
  [issue #65](https://github.com/cloudflare/miniflare/issues/65), thanks
  [@maraisr](https://github.com/maraisr).
- Added an alias, `-B`, for the `--build-command` option
- Multiple build watch paths can now be specified. If any of them change, your
  worker will rebuild and reload.
- Fixed an issue where workers would not rebuild if the build watch path started
  with `./`. Closes
  [issue #53](https://github.com/cloudflare/miniflare/issues/53), thanks
  [@janat08](https://github.com/janat08).

**Standards:**

- **Added support for
  [`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)**
- **Added support for the `NODE-ED25519` algorithm** to `crypto.subtle.sign()`
  and `crypto.subtle.verify()`
- Throw an error when attempting to create a new `TextDecoder` with a non-UTF-8
  encoding
- Throw errors when attempting to use `FetchEvent`/`ScheduledEvent` methods with
  incorrectly bound `this`
- Throw errors when attempting to call `respondWith()` twice, or after the
  `fetch` handler has finished executing synchronously. Closes
  [issue #63](https://github.com/cloudflare/miniflare/issues/63), thanks
  [@Kikobeats](https://github.com/Kikobeats).
- Added support for the `unhandledrejection` and `rejectionhandled` events
- Throw an error (with a suggested fix) when trying to access an `env` binding
  globally in modules mode
- Throw errors when trying to use `addEventListener()`, `removeEventListener()`
  and `dispatchEvent()` globals in modules mode
- Split the
  `FetchError: No fetch handler responded and unable to proxy request to upstream?`
  error into more specific errors with suggested fixes
- Added the
  [non-standard `Headers#getAll()` method](https://developers.cloudflare.com/workers/runtime-apis/headers#differences).
  This can only be used with the `Set-Cookie` header.
- Switch to a
  [more spec-compliant `fetch` implementation](https://github.com/nodejs/undici/),
  and get `crypto`, `EventTarget` and Web Streams from Node.js. Closes
  [issues #56](https://github.com/cloudflare/miniflare/issues/56) and
  [#59](https://github.com/cloudflare/miniflare/issues/59), thanks
  [@jasnell](https://github.com/jasnell),
  [@jonathannorris](https://github.com/jonathannorris) and
  [@SupremeTechnopriest](https://github.com/SupremeTechnopriest).
- Throw an error when attempting to construct a WebSocket response with a status
  other than `101`
- Throw an error when attempting to clone a WebSocket response
- Added support for the non-standard
  `ReadableStreamBYOBReader#readAtLeast(size, buffer)` method
- Include `File` in the Miniflare sandbox. Closes
  [issue #66](https://github.com/cloudflare/miniflare/issues/66), thanks
  [@tranzium](https://github.com/tranzium).

**Bindings:**

- Added `--global KEY=VALUE`/`globals: { KEY: "value" }` option for binding
  arbitrary values to the global scope. This behaves exactly like the
  `--binding`/`bindings: { ... }` option, but always binds to the global scope,
  even in modules mode.
- Added a new global variable `MINIFLARE` to the Miniflare sandbox, which will
  always have the value `true` when your script is running within Miniflare
- Miniflare now stringifies all environment variables from `wrangler.toml`.
  Closes [issue #50](https://github.com/cloudflare/miniflare/issues/50), thanks
  [@ozburo](https://github.com/ozburo).

**Core:**

- **Added support for compatibility dates and flags**, specifically the flags
  `durable_object_fetch_requires_full_url`, `fetch_refuses_unknown_protocols`,
  **`formdata_parser_supports_files`** are now supported. This feature is
  exposed under the `--compat-date` and `--compat-flag` CLI options, in addition
  to the standard keys in `wrangler.toml`. Closes
  [issue #48](https://github.com/cloudflare/miniflare/issues/48), thanks
  [@PaganMuffin](https://github.com/PaganMuffin).
- **Added a proper CommonJS module loader.** Workers built with Webpack will be
  more likely to work with Miniflare now. Closes
  [issue #44](https://github.com/cloudflare/miniflare/issues/44), thanks
  [@TimTinkers](https://github.com/TimTinkers).
- Incoming request headers are now immutable. Closes
  [issue #36](https://github.com/cloudflare/miniflare/issues/36), thanks
  [@grahamlyons](https://github.com/grahamlyons).
- Disabled dynamic WebAssembly compilation in the Miniflare sandbox
- Fixed `instanceof` on primitives such as `Object`, `Array`, `Promise`, etc.
  from outside the Miniflare sandbox. This makes it much easier to run Rust
  workers in Miniflare, as `wasm-bindgen` frequently generates this code.
- Added a new `--verbose`/`verbose: true` option that enables verbose logging
  with more debugging information
- Throw a more helpful error with suggested fixes when Miniflare can't find your
  worker's script
- Only rebuild parts of the sandbox that need to change when options are updated
- Added a new reload event to `Miniflare` instances that is dispatched whenever
  the worker reloads:

  ```js
  const mf = new Miniflare({ ... });
  mf.addEventListener("reload", (event) => {
    console.log("Worker reloaded!");
  });
  ```

- Added a new `Miniflare#getGlobalScope()` method for getting the global scope
  of the Miniflare sandbox. This allows you to access and manipulate the
  Miniflare environment whilst your worker is running without reloading it.
  Closes [issue #38](https://github.com/cloudflare/miniflare/issues/38), thanks
  [@cdloh](https://github.com/cdloh).
- Added a new `Miniflare#startScheduler()` method that starts a CRON scheduler
  that dispatches `scheduled` events according to CRON expressions in options

**Durable Objects:**

- **Added input and output gates** for ensuring consistency without explicit
  transactions
- **Added write coalescing** for `put`/`delete` without interleaving `await`s
  for automatic atomic writes
- Added the `DurableObjectState#blockConcurrencyWhile(callback)` method. This
  prevents new `fetch` events being delivered to your object whilst the callback
  runs. Closes [issue #45](https://github.com/cloudflare/miniflare/issues/45),
  thanks [@gmencz](https://github.com/gmencz).
- Added the `DurableObjectId#equals(id)` method for comparing if 2 Durable
  Object IDs have the same hex-ID
- Automatically resolve relative URLs passed to
  `DurableObjectStub#fetch(input, init?)` against `https://fast-host`. Closes
  [issue #27](https://github.com/cloudflare/miniflare/issues/27), thanks
  [@halzy](https://github.com/halzy).
- Throw an error if the string passed to
  `DurableObjectNamespace#idFromString(hexId)` is not 64 hex digits
- Throw an error if the hex-ID passed to
  `DurableObjectNamespace#idFromString(hexId)` is for a different Durable Object
- Throw an error if the ID passed to `DurableObjectNamespace#get(id)` is for a
  different Durable Object
- Throw an error when keys are greater than `2KiB` or `undefined`
- Throw an error when values are greater than `32KiB`
- Throw an error when attempting to `get`, `put` or `delete` more than `128`
  keys, or when attempting to modify more than `128` keys in a transaction
- Throw an error when attempting to `put` an `undefined` value
- Throw an error when attempting to list keys with a negative `limit`
- Throw an error when attempting to perform an operation in a rolledback
  transaction or in a transaction that has already committed
- Throw an error when attempting to call `deleteAll()` in a transaction
- Use the same V8 serialization as Cloudflare Workers to store values
- Fixed an issue where keys added in a transaction callback were not reported as
  deleted in the same transaction
- Fixed an issue where keys added in a transaction callback were not included in
  the list of keys in the same transaction

**HTTP Server:**

- **Added a live reload feature** (powered by `HTMLRewriter` 😄), that
  automatically refreshes your browser when your worker reloads. For this to
  work, pass the `--live-reload` option, and return an HTML response containing
  a `<body>` tag with the `Content-Type` set to `text/html`:

  ```js
  addEventListener("fetch", (event) => {
    const body = `
      <!DOCTYPE html>
      <html>
      <body>
        <p>Try update me!</p>
      </body>
      </html>
    `;

    const res = new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

    event.respondWith(res);
  });
  ```

- **Automatically fetch the incoming `Request#cf` object** from a trusted
  Cloudflare endpoint, so the values are the same as you'd get for real. Closes
  [issue #61](https://github.com/cloudflare/miniflare/issues/61), thanks
  [@aaronsdevera](https://github.com/aaronsdevera) and
  [@Electroid](https://github.com/Electroid).
- Added a `metaProvider` option that allows you fetch metadata for an incoming
  `Request`:

  ```js
  const mf = new Miniflare({
    async metaProvider(req) {
      return {
        forwardedProto: req.headers["X-Forwarded-Proto"],
        realIp: req.headers["X-Forwarded-For"],
        cf: {
          // Could get these from a geo-IP database
          colo: "SFO",
          country: "US",
          // ...
        },
      };
    },
  });
  ```

- Split out the Node request to `Request` object conversion logic into a
  `convertNodeRequest(req, upstream?, meta?)` function. You can import this from
  `@miniflare/http-server`.
- Only return a pretty-error page when the request `Accept` header includes
  `text/html`
- Added a new `Miniflare#startServer(options?)` method that starts an HTTP
  server using the configured `port` and `host`. `options` can be a
  `http.ServerOptions` or `https.ServerOptions` object. Closes
  [issue #39](https://github.com/cloudflare/miniflare/issues/39), thanks
  [@amlwwalker](https://github.com/amlwwalker)
- Include a default `Content-Type` header of `text/plain` in `Response`s. Closes
  [issue #57](https://github.com/cloudflare/miniflare/issues/57), thanks
  [@Rysertio](https://github.com/Rysertio).

**KV:**

- Throw an error when keys are empty, `.`, `..`, `undefined`, or greater than
  `512B` when UTF-8 encoded
- Throw an error when values are greater than `25MiB`
- Throw an error when metadata is greater than `1KiB`
- Throw an error when the `cacheTtl` option is less than `60s`
- Throw an error when `expirationTtl` is non-numeric, less than or equal 0, or
  less than `60s`
- Throw an error when `expiration` is non-numeric, less than or equal the
  current time, or less than `60s` in the future
- Throw an error when the `limit` passed to `KVNamespace#list()` is non-numeric,
  less than or equal `0`, or greater than `1000`

**Scheduler:**

- Moved the `/.mf/scheduled` endpoint for triggering scheduled events to
  `/cdn-cgi/mf/scheduled`. Closes
  [issue #42](https://github.com/cloudflare/miniflare/issues/42), thanks
  [@ObsidianMinor](https://github.com/ObsidianMinor).

**Web Sockets:**

- Added support for **sending/receiving binary messages**. Closes
  [issue #67](https://github.com/cloudflare/miniflare/issues/67), thanks
  [@NostalgiaRunner](https://github.com/NostalgiaRunner).
- Removed the `WebSocket#readyState` property. Closes
  [issue #47](https://github.com/cloudflare/miniflare/issues/47), thanks
  [@aboodman](https://github.com/aboodman).
- Throw an error when attempting to use a `WebSocket` in a `Response` that has
  already been used
- Throw an error when attempting to use a `WebSocket` in a `Response` after
  calling `accept()` on it
- Throw an error when attempting to construct a `WebSocket` using the
  `WebSocket` constructor
- Throw an error when attempting to call `WebSocket#send()` or
  `WebSocket#close()` without first calling `accept()`. Closes
  [issue #43](https://github.com/cloudflare/miniflare/issues/43), thanks
  [@aboodman](https://github.com/aboodman).
- Throw an error when attempting to call `WebSocket#send()` after calling
  `close()`
- Throw an error when attempting to call `WebSocket#close()` on an already
  closed WebSocket
- Throw an error when attempting to call `WebSocket#close()` with an invalid
  close code

## 1.4.1

### Fixes

- Fixed linking of modules with cyclic imports, allowing
  [new Rust workers](https://blog.cloudflare.com/workers-rust-sdk/) to be run
  with Miniflare. Closes
  [issue #41](https://github.com/cloudflare/miniflare/issues/41), thanks
  [@nuvanti](https://github.com/nuvanti).
- Fixed handling of `ArrayBufferView`s as `Response` bodies

## 1.4.0

### Features

- Added `Event` and `EventTarget` to the sandbox. The global scope and
  `WebSocket` now inherit from `EventTarget` so `removeEventListener` is now
  supported. Closes
  [issue #18](https://github.com/cloudflare/miniflare/issues/18), thanks
  [@jayphelps](https://github.com/jayphelps).
- Added workers' uncompressed size to logs, closes
  [issue #23](https://github.com/cloudflare/miniflare/issues/23), thanks
  [@ItsWendell](https://github.com/ItsWendell)
- Switch to lighter dependencies, thanks [@lukeed](https://github.com/lukeed).
  There's still lots of work to do here for the next major release.

### Fixes

- Require the `GET` method for WebSocket upgrades, closes
  [issue #25](https://github.com/cloudflare/miniflare/issues/25), thanks
  [@ItsWendell](https://github.com/ItsWendell)
- Added `WebSocket` to the sandbox, closes
  [issue #30](https://github.com/cloudflare/miniflare/issues/30), thanks
  [@ItsWendell](https://github.com/ItsWendell). Note you still need to use
  `WebSocketPair` and `fetch` to set up WebSocket connections. See
  [✉️ WebSockets](https://miniflare.dev/web-sockets.html) for more details.
- Fixed caching with `URL` request keys, closes
  [issue #33](https://github.com/cloudflare/miniflare/issues/33), thanks
  [@TimTinkers](https://github.com/TimTinkers)
- Disable the watcher whilst rebuilding, closes
  [issue #34](https://github.com/cloudflare/miniflare/issues/34), thanks
  [@TimTinkers](https://github.com/TimTinkers)

## 1.3.3

### Features

- Added an option to disable default and named caches. When disabled, the caches
  will still be available in the sandbox, they just won't cache anything. Thanks
  [@frandiox](https://github.com/frandiox) for the suggestion. See
  [✨ Cache](https://miniflare.dev/cache.html#disabling) for more details.
- Added the corresponding `wrangler.toml` key for the `--disable-updater` flag:
  `miniflare.disable_updater`

### Fixes

- Fixed the `package.json` file path the update checker checked against

## 1.3.2

### Features

- Responses are now streamed when using the built-in HTTP(S) server
- Return values of Durable Object transaction closures are now propagated as the
  return value of the `transaction` call

### Fixes

- Upgraded [`html-rewriter-wasm`](https://github.com/mrbbot/html-rewriter-wasm)
  to version `0.3.2`, fixing `async` handler support, closes
  [`html-rewriter-wasm` issue #1](https://github.com/mrbbot/html-rewriter-wasm/issues/1)

## 1.3.1

### Fixes

- Upgraded [`html-rewriter-wasm`](https://github.com/mrbbot/html-rewriter-wasm)
  to version `0.3.1`, fixing the return type of `Element.attributes`

## 1.3.0

### Features

- Switched to a [`lol-html`](https://github.com/cloudflare/lol-html)-based
  WebAssembly implementation of `HTMLRewriter` for a more accurate simulation of
  the real Workers environment. See
  [📄 HTMLRewriter](https://miniflare.dev/html-rewriter.html) for more details.
- Added HTTPS support for local development, thanks
  [@RichiCoder1](https://github.com/RichiCoder1) for the
  [suggestion (#12)](https://github.com/cloudflare/miniflare/issues/12). See
  [💻 Using the CLI](https://miniflare.dev/cli.html#https-server) and
  [🧰 Using the API](https://miniflare.dev/api.html#https-server) for more
  details.
- When using the CLI, the `--watch` flag is now assumed if `--build-watch-path`
  is set, thanks [@evanderkoogh](https://github.com/evanderkoogh) for the
  [PR (#8)](https://github.com/cloudflare/miniflare/pull/8)
- Added source maps to `CommonJS` module transformation

### Fixes

- Switched to real values for the `cf` property, thanks
  [@chase](https://github.com/chase) for the
  [PR (#11)](https://github.com/cloudflare/miniflare/pull/11)
- Upgraded the TOML parser to support dotted keys, thanks
  [@leader22](https://github.com/leader22) for the
  [PR (#13)](https://github.com/cloudflare/miniflare/pull/13)
- Added `CryptoKey` to the sandbox, thanks [@mosch](https://github.com/mosch)
  for the [PR (#14)](https://github.com/cloudflare/miniflare/pull/14)

## 1.2.0

### Features

- Added **Redis** persistence support for
  [📦 KV](https://miniflare.dev/kv.html#persistence),
  [✨ Cache](https://miniflare.dev/cache.html#persistence) and
  [📌 Durable Objects](https://miniflare.dev/durable-objects.html#persistence)
- Added support for loading scripts from `package.json`, closes
  [issue #7](https://github.com/cloudflare/miniflare/issues/7). See
  [💻 Using the CLI](https://miniflare.dev/cli.html#script-requirement) and
  [⚡️ Developing with esbuild](https://miniflare.dev/recipes/esbuild.html#dependencies)
  for more details.
- Added `FormData` to the sandbox, closes
  [issue #6](https://github.com/cloudflare/miniflare/issues/6)
- Added an automatic update checker. See
  [💻 Using the CLI](https://miniflare.dev/cli.html#update-checker) for more
  details.
- [📚 Modules](https://miniflare.dev/modules.html) mode is now always enabled
  when specifying
  [📌 Durable Objects](https://miniflare.dev/durable-objects.html##objects)
  bindings

### Fixes

- Fixed **Windows** support, closes
  [issue #10](https://github.com/cloudflare/miniflare/issues/10)
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
  [issue #3](https://github.com/cloudflare/miniflare/issues/3)
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
  [issue #2](https://github.com/cloudflare/miniflare/issues/2)

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
