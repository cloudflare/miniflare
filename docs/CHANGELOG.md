# 🚧 Changelog

## 2.6.0

### Features

- 🪣 **Add support for R2 bucket bindings.** Closes
  [issue #276](https://github.com/cloudflare/miniflare/issues/276), thank you so
  much [@CraigglesO](https://github.com/CraigglesO) for
  [the _massive_ PR](https://github.com/cloudflare/miniflare/pull/289).
- Add support for
  [`navigator.userAgent`](https://developers.cloudflare.com/workers/platform/compatibility-dates#global-navigator).
  Closes [issue #209](https://github.com/cloudflare/miniflare/issues/209),
  thanks [@Electroid](https://github.com/Electroid).
- Return fixed time from `new Date()`/`Date.now()`, unless the
  `--actual-time`/`actualTime: true` option is set, to match
  [the behaviour the Workers runtime](https://developers.cloudflare.com/workers/learning/security-model/#step-1-disallow-timers-and-multi-threading).
  Closes [issue #225](https://github.com/cloudflare/miniflare/issues/225),
  thanks [@ItalyPaleAle](https://github.com/ItalyPaleAle).
- Add support for
  [`(De)CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API).
  Closes [issue #206](https://github.com/cloudflare/miniflare/issues/206),
  thanks [@Electroid](https://github.com/Electroid).
- Add an interactive REPL via the `--repl` flag. Any other flag can be passed
  too, and options will automatically be loaded from `wrangler.toml` files.
  Specifying a script is optional when `--repl` is enabled. The REPL can also be
  started programmatically via the `Miniflare#startREPL()` method. See []() for
  more details. Thanks [@threepointone](https://github.com/threepointone) for
  the idea over at
  [cloudflare/wrangler2#1263](https://github.com/cloudflare/wrangler2/issues/1263).

### Fixes

- Load service bindings from `services` instead of `experimental_services`, and
  use `binding` instead of `name` for the binding name. Thanks
  [@jrencz](https://github.com/jrencz) for
  [the PR](https://github.com/cloudflare/miniflare/pull/302).
  [issue #280](https://github.com/cloudflare/miniflare/issues/280).
- Log warning instead of error when fetching `Request#cf` object fails. Closes
  [issue #224](https://github.com/cloudflare/miniflare/issues/224), thanks
  [@threepointone](https://github.com/threepointone).
- Increase the subrequest limit for `unbound` workers from 50 to 1000, and limit
  the number of calls to internal APIs such as KV/Durable Object to 1000. Closes
  [issue #274](https://github.com/cloudflare/miniflare/issues/274), thanks
  [@isaac-mcfadyen](https://github.com/isaac-mcfadyen).
- Fix logging of accessible hosts in Node.js 18
- Remove `name` from `DurableObjectId`s in `DurableObjectState` to match the
  behaviour of the Workers runtime. Closes
  [issue #219](https://github.com/cloudflare/miniflare/issues/219).
- Allow failure WebSocket upgrade responses. Closes
  [issue #174](https://github.com/cloudflare/miniflare/issues/174), thanks
  [@jinjor](https://github.com/jinjor).
- Correctly handle internationalised domain names in routes. Closes
  [issue #186](https://github.com/cloudflare/miniflare/issues/186), thanks
  [@dsod](https://github.com/dsod).
- Improve the error message when Durable Object bindings are missing a script to
  mention mounting. Closes
  [issue #221](https://github.com/cloudflare/miniflare/issues/221), thanks
  [@konsumer](https://github.com/konsumer).
- Allow WebSockets to be closed without a status code. Closes
  [issue #284](https://github.com/cloudflare/miniflare/issues/284), thanks
  [@hansottowirtz](https://github.com/hansottowirtz).
- Allow Durable Object alarms to be scheduled less than 30 seconds in the
  future. Closes
  [issue #290](https://github.com/cloudflare/miniflare/issues/290), thanks
  [@wighawag](https://github.com/wighawag) and
  [@CraigglesO](https://github.com/CraigglesO) for
  [the PR](https://github.com/cloudflare/miniflare/pull/294).
- Fix `DurableObjectStorage#list()` when alarms are scheduled. Closes
  [issue #297](https://github.com/cloudflare/miniflare/issues/297), thanks
  [@evanderkoogh](https://github.com/evanderkoogh) and
  [@CraigglesO](https://github.com/CraigglesO) for
  [the PR](https://github.com/cloudflare/miniflare/pull/298).

## 2.5.1

### ⚠️ Security Update

- Upgrade `undici` to `5.5.1`, addressing
  [GHSA-pgw7-wx7w-2w33](https://github.com/advisories/GHSA-pgw7-wx7w-2w33)
- Upgrade `node-forge` to `1.3.1`, addressing
  [GHSA-2r2c-g63r-vccr](https://github.com/advisories/GHSA-2r2c-g63r-vccr),
  [GHSA-x4jg-mjrx-434g](https://github.com/advisories/GHSA-x4jg-mjrx-434g) and
  [GHSA-cfm4-qjh2-4765](https://github.com/advisories/GHSA-cfm4-qjh2-4765)
- Upgrade `minimist` to `1.2.6`, addressing
  [GHSA-xvch-5gv4-984h](https://github.com/advisories/GHSA-xvch-5gv4-984h)

## 2.5.0

### Features

- ⏰ Add support for
  [**Durable Object alarms**](https://developers.cloudflare.com/workers/learning/using-durable-objects/#alarms-in-durable-objects).
  Thanks [@CraigglesO](https://github.com/CraigglesO) for [the PR](#257).
- Add support for `URLPattern`. Closes
  [issue #199](https://github.com/cloudflare/miniflare/issues/199), thanks
  [@Electroid](https://github.com/Electroid) and
  [@tom-sherman](https://github.com/tom-sherman) for
  [the PR](https://github.com/cloudflare/miniflare/pull/260).
- Add support for the
  [`Response.json()`](https://community.cloudflare.com/t/2022-5-26-workers-runtime-release-notes/386584)
  static method. Closes
  [issue #272](https://github.com/cloudflare/miniflare/issues/272), thanks
  [@Cherry](https://github.com/Cherry).
- Add support for the
  [`startAfter`](https://developers.cloudflare.com/workers/runtime-apis/durable-objects#methods)
  Durable Object `list()` option. Closes
  [issue #266](https://github.com/cloudflare/miniflare/issues/266), thanks
  [@vlovich](https://github.com/vlovich).
- Add support for Jest 28 and custom
  [export conditions](https://nodejs.org/api/packages.html#conditional-exports).
  By default, the Miniflare Jest environment will use the `worker` condition,
  followed by `browser`. Closes issues
  [#249](https://github.com/cloudflare/miniflare/issues/249) and
  [#255](https://github.com/cloudflare/miniflare/issues/255), thanks
  [@awwong1](https://github.com/awwong1) and
  [@SupremeTechnopriest](https://github.com/SupremeTechnopriest).

### Fixes

- Fixed issue where `403 Forbidden` responses were returned when a site behind
  Cloudflare was set as the upstream. Closes
  [issue #237](https://github.com/cloudflare/miniflare/issues/237), thanks
  [@james-maher](https://github.com/james-maher) for
  [the PR](https://github.com/cloudflare/miniflare/pull/238).
- Respect `env_path` option in `wrangler.toml` when using mounts or the
  Miniflare Jest environment. Closes
  [issue #240](https://github.com/cloudflare/miniflare/issues/240), thanks
  [@bkniffler](https://github.com/bkniffler).
- Fix cases where BYOB readers didn't notice the end of the stream. Closes
  [issue #192](https://github.com/cloudflare/miniflare/issues/192), thanks
  [@vlovich](https://github.com/vlovich) for
  [the PR](https://github.com/cloudflare/miniflare/pull/194).
- Wait for unawaited writes within a Durable Object transaction before
  attempting to commit. Closes
  [issue #250](https://github.com/cloudflare/miniflare/issues/250), thanks
  [@vlovich](https://github.com/vlovich).
- Correctly bind `this` in `crypto` and `crypto.subtle`. Closes
  [issue #256](https://github.com/cloudflare/miniflare/issues/256), thanks
  [@lmcarreiro](https://github.com/lmcarreiro) and
  [@awwong1](https://github.com/awwong1) for
  [the PR](https://github.com/cloudflare/miniflare/pull/259/).
- Bump `busboy` to resolve a
  [security issue](https://github.com/advisories/GHSA-wm7h-9275-46v2). Closes
  [issue #267](https://github.com/cloudflare/miniflare/issues/267), thanks
  [@grempe](https://github.com/grempe) and [@Cherry](https://github.com/Cherry)
  for [the PR](https://github.com/cloudflare/miniflare/pull/269/).
- Set incoming `Accept-Encoding` headers to `gzip` and put actual client
  encodings in `request.cf.clientAcceptEncoding` to match the behaviour of the
  Workers runtime. Closes
  [issue #180](https://github.com/cloudflare/miniflare/issues/180), thanks
  [@evanderkoogh](https://github.com/evanderkoogh) and
  [@leader22](https://github.com/leader22) for
  [the PR](https://github.com/cloudflare/miniflare/pull/213/).
- [Remove restriction](https://community.cloudflare.com/t/2022-2-25-workers-runtime-release-notes/360450)
  on supported `TextDecoder` encodings. Closes
  [issue #212](https://github.com/cloudflare/miniflare/issues/212).
- Make `headers` on returned `fetch` `Response`s immutable. Closes
  [issue #242](https://github.com/cloudflare/miniflare/issues/242), thanks
  [@nickreese](https://github.com/nickreese).
- Use lexicographic ordering for KV/Durable Object `list()`s. Closes
  [issue #235](https://github.com/cloudflare/miniflare/issues/235), thanks
  [@vlovich](https://github.com/vlovich).
- Re-export `Request`, `RequestInfo`, `RequestInit` and `Response` from
  `miniflare`. Closes
  [issue #258](https://github.com/cloudflare/miniflare/issues/258), thanks
  [@ajwootto](https://github.com/ajwootto).
- Add `jest-environment-miniflare`'s missing `dependencies`. Thanks
  [@BasixKOR](https://github.com/BasixKOR) for
  [the PR](https://github.com/cloudflare/miniflare/pull/195).

## 2.4.0

### Features

- Add support for `[text_blobs]`. Closes
  [issue #211](https://github.com/cloudflare/miniflare/issues/211), thanks
  [@caass](https://github.com/caass) for
  [the PR](https://github.com/cloudflare/miniflare/pull/228).
- Add support for `[data_blobs]`. Closes
  [issue #231](https://github.com/cloudflare/miniflare/issues/231), thanks
  [@threepointone](https://github.com/threepointone) for
  [the PR](https://github.com/cloudflare/miniflare/pull/232).
- Do not display the pretty error page when making requests with `curl`. Closes
  [issue #198](https://github.com/cloudflare/miniflare/issues/198), thanks
  [@GregBrimble](https://github.com/GregBrimble) for
  [the PR](https://github.com/cloudflare/miniflare/pull/210).

### Fixes

- Pass correctly-typed value to `webcrypto.getRandomValues()`. Closes
  [issue #188](https://github.com/cloudflare/miniflare/issues/188), thanks
  [@vlovich](https://github.com/vlovich).
- Fix `fetch` with `Content-Length: 0` header. Closes
  [issue #193](https://github.com/cloudflare/miniflare/issues/193), thanks
  [@orls](https://github.com/orls) for
  [the PR](https://github.com/cloudflare/miniflare/pull/204).
- Bind `this` to `webcrypto` methods, fixing `crypto.getRandomValues()` and
  `crypto.subtle.generateKey()`. Thanks [@szkl](https://github.com/szkl) for
  [the PR](https://github.com/cloudflare/miniflare/pull/216).

## 2.3.0

### Features

- Route `/cdn-cgi/mf/scheduled` requests based on mount routes. Closes
  [issue #163](https://github.com/cloudflare/miniflare/issues/163), thanks
  [@jed](https://github.com/jed).
- Add clear error if a Durable Object class is missing a `fetch` handler. Closes
  [issue #164](https://github.com/cloudflare/miniflare/issues/164), thanks
  [@aboodman](https://github.com/aboodman).
- Upgrade [`undici`](https://github.com/nodejs/undici) to
  [`4.13.0`](https://github.com/nodejs/undici/releases/tag/v4.13.0)

### Fixes

- Fix `instanceof` when subclassing `Error`. Subclasses of `Error` were
  previously treated as `Error`s themselves in `instanceof` checks. Closes
  [issue #159](https://github.com/cloudflare/miniflare/issues/159), thanks
  [@valeriangalliat](https://github.com/valeriangalliat).
- Return `null` bodies when `fetch`ing `Response`s with a null status. Closes
  [issue #165](https://github.com/cloudflare/miniflare/issues/165), thanks
  [@lukaszczerpak](https://github.com/lukaszczerpak) for reporting this and
  [@GregBrimble](https://github.com/GregBrimble) for
  [the PR](https://github.com/cloudflare/miniflare/pull/172).
- Clone `ArrayBuffer` bodies when constructing `Request`/`Response`s. Closes
  [issue #171](https://github.com/cloudflare/miniflare/issues/171), thanks
  [@segator](https://github.com/segator) and
  [@leader22](https://github.com/leader22).
- Watch `index.js` by default in `type = "webpack"` projects
- Throw `TypeError`s instead of `string`s on `HTMLRewriter` parser errors
- Disable nested mounts via `Miniflare#getMount().setOptions()`

## 2.2.0

### Features

- Add support for the `HTMLRewriter`
  [`Element#onEndTag(handler)`](https://github.com/cloudflare/workers-types/blob/17d21e9ae7cfee0c5d6ca4bf247978e5618c0386/index.d.ts#L466-L474)
  [method](https://community.cloudflare.com/t/2022-01-17-workers-runtime-release-notes/346596)
- Add support for the
  [`html_rewriter_treats_esi_include_as_void_tag`](https://developers.cloudflare.com/workers/platform/compatibility-dates#htmlrewriter-handling-of-esiinclude)
  compatibility flag
- Make the error message when attempting to import Node.js built-in modules more
  helpful

### Fixes

- Fix `instanceof` checks with `null` values. Closes issues
  [#152](https://github.com/cloudflare/miniflare/issues/152) and
  [#154](https://github.com/cloudflare/miniflare/issues/154). Thanks
  [@Cerberus](https://github.com/Cerberus) for
  [the PR](https://github.com/cloudflare/miniflare/pull/155), and
  [@bduff9](https://github.com/bduff9), [@huw](https://github.com/huw) &
  [@g45t345rt](https://github.com/g45t345rt) for reporting this.
- Fix subdirectory watching on Linux. Closes
  [issue #153](https://github.com/cloudflare/miniflare/issues/153), thanks
  [@huw](https://github.com/huw) for reporting this.
- Throw a `TypeError` instead of a `string` when the parameter passed to a
  `HTMLRewriter` handler is used outside the handler

## 2.1.0

### Features

- Allow multiple build watch paths to be set in `wrangler.toml` files. Use the
  `[miniflare] build_watch_dirs` option. Note this gets merged with the regular
  `[build] watch_dir` option:

  ```toml
  [build]
  watch_dir = "src1"

  [miniflare]
  build_watch_dirs = ["src2", "src3"]
  ```

- WebSocket handshake headers are now included in responses from the HTTP server
  and WebSocket upgrade `fetch`es. Closes
  [issue #151](https://github.com/cloudflare/miniflare/issues/151), thanks
  [@jed](https://github.com/jed).

### Fixes

- Allow Miniflare to be installed with
  [Yarn PnP](https://yarnpkg.com/features/pnp). Closes
  [issue #144](https://github.com/cloudflare/miniflare/issues/144), thanks
  [@lookfirst](https://github.com/lookfirst),
  [@merceyz](https://github.com/merceyz), and
  [@DJtheRedstoner](https://github.com/DJtheRedstoner).
- Use the actual body length for the `Content-Length` header in HTTP server
  responses, instead of the value provided in the `Response` constructor. Closes
  [issue #148](https://github.com/cloudflare/miniflare/issues/148), thanks
  [@lukaszczerpak](https://github.com/lukaszczerpak).
- Don't rewrite the `Host` header to match the upstream URL. Closes
  [issue #149](https://github.com/cloudflare/miniflare/issues/149), thanks
  [@hansede](https://github.com/hansede).
- Bump dependencies, fixing `npm audit` warnings. Thanks
  [@leader22](https://github.com/leader22) for
  [the PR](https://github.com/cloudflare/miniflare/pull/150).
- Make `instanceof` spec-compliant, ensuring checks like
  `Object instanceof Object` succeed. This particular check was used by Lodash's
  `_.isPlainObject()` method, which is internally called by `_.merge()`, causing
  unexpected results.
- Make the unimplemented `Response#type` property non-enumerable
- Copy header guard when `clone()`ing `Request`s, ensuring `Request`s with
  immutable headers still have immutable headers when `clone()`ed
- Fix race conditions in file-system watcher

## 2.0.0

Miniflare 2 has been completely redesigned from version 1 with 3 primary design
goals:

1. 📚 **Modular:** Miniflare 2 splits Workers components (KV, Durable Objects,
   etc.) into **separate packages** (`@miniflare/kv`,
   `@miniflare/durable-objects`, etc.) that you can import separately for
   testing.
2. ✨ **Lightweight:** Miniflare 1 included
   [122 third-party packages](http://npm.anvaka.com/#/view/2d/miniflare) with a
   total install size of `88MB`. Miniflare 2 reduces this to **24 packages and
   `6MB`** by leveraging features included with Node.js 16.
3. ✅ **Accurate:** Miniflare 2 more accurately replicates the quirks and thrown
   errors of the real Workers runtime, so you'll know before you deploy if
   things are going to break.

Check out the [migration guide](https://miniflare.dev/get-started/migrating) if
you're upgrading from version 1.

### Notable Changes

- ✳️ Node.js 16.7.0 is now the minimum required version
- 🤹 Added a custom Jest test environment, allowing you to run unit tests in the
  Miniflare sandbox, with isolated storage for each test
- 🔌 Added support for running multiple workers in the same Miniflare instance
- ⚡️ Added a live reload feature (`--live-reload`) that automatically refreshes
  your browser when your worker reloads
- 🚪 Added Durable Object input and output gates, and write coalescing
- 🛑 Added the `DurableObjectState#blockConcurrencyWhile(callback)` method
- 📅 Added support for compatibility dates and flags:
  `durable_object_fetch_requires_full_url`, `fetch_refuses_unknown_protocols`,
  `formdata_parser_supports_files`
- 📚 Added a proper CommonJS module loader
- 🗺 Automatically fetch the incoming `Request#cf` object from a trusted
  Cloudflare endpoint
- 🎲 Added support for `crypto.randomUUID()`
- 🔐 Added support for the `NODE-ED25519` algorithm
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
- Correctly implement the Durable Object `script_name` option. In Miniflare 1,
  this incorrectly expected a script path instead of a script name. This now
  relies on mounting the other worker. See
  [📌 Durable Objects](https://miniflare.dev/storage/durable-objects#using-a-class-exported-by-another-script)
  for more details.
- Removed the non-standard `DurableObjectStub#storage()` method. To access
  Durable Object storage outside a worker, use the new
  `Miniflare#getDurableObjectStorage(id)` method, passing a `DurableObjectId`
  obtained from a stub. See
  [📌 Durable Objects](https://miniflare.dev/storage/durable-objects#manipulating-outside-workers)
  for more details.
- Renamed the `--disable-cache`/`disableCache: true` option to
  `--no-cache`/`cache: false`
- Renamed the `--disable-updater` option to `--no-update-check`
- When using the API, `wrangler.toml`, `package.json` and `.env` are no longer
  automatically loaded from their default locations. To re-enable this
  behaviour, set these options to `true`:

  ```js
  const mf = new Miniflare({
    wranglerConfigPath: true,
    packagePath: true,
    envPath: true,
  });
  ```

- Replaced the `ConsoleLog` class with the `Log` class from `@miniflare/shared`.
  You can construct this with a `LogLevel` to control how much information is
  logged to the console:

  ```js
  import { Miniflare, Log, LogLevel } from "miniflare";

  const mf = new Miniflare({
    log: new Log(LogLevel.DEBUG),
  });
  ```

- Load WASM bindings from the standard `wasm_modules` `wrangler.toml` key
  instead of `miniflare.wasm_bindings`.

  ```toml
  ---
  filename: wrangler.toml
  ---
  [miniflare]
  wasm_bindings = [
    { name = "MODULE1", path="module1.wasm" },
    { name = "MODULE2", path="module2.wasm" }
  ]
  ```

  ...should now be...

  ```toml
  ---
  filename: wrangler.toml
  ---
  [wasm_modules]
  MODULE1 = "module1.wasm"
  MODULE2 = "module2.wasm"
  ```

- Renamed the `buildWatchPath` option to `buildWatchPaths`. This is now an array
  of string paths to watch as opposed to a single string.
- Replaced the `Miniflare#reloadOptions()` method with the `Miniflare#reload()`
  and `Miniflare#setOptions({ ... })` methods. `reload()` will reload options
  from `wrangler.toml` (useful if not watching), and `setOptions()` accepts the
  same options object as the `new Miniflare` constructor, applies those options,
  then reloads the worker.
- Replaced the `Miniflare#getCache()` method the `Miniflare#getCaches()` method.
  This returns the global `caches` object. See
  [✨ Cache ](https://miniflare.dev/storage/cache#manipulating-outside-workers).
- `Miniflare#createServer()` now always returns a `Promise` which you must await
  to get a `http.Server`/`https.Server` instance. You may want to check out the
  new `Miniflare#startServer()` method which automatically starts a server using
  the configured `host` and `port`.
- Redis support is no longer included by default. If you're persisting KV,
  Durable Objects or cached responses in Redis, you must install the
  `@miniflare/storage-redis` optional peer dependency.
- Replaced how Miniflare sanitises file paths for file-system storage so
  namespace separators (`/`, `\`, `:` and `|`) now create new directories.
- The result of `Miniflare#dispatchScheduled` will no longer include `undefined`
  if a module scheduled handler doesn't return a value

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

**Core:**

- **Added support for running multiple workers** in the same Miniflare instance.
  See [🔌 Multiple Workers](https://miniflare.dev/core/mount) for more details.
- **Added support for compatibility dates and flags**, specifically the flags
  `durable_object_fetch_requires_full_url`, `fetch_refuses_unknown_protocols`,
  **`formdata_parser_supports_files`** are now supported. This feature is
  exposed under the `--compat-date` and `--compat-flag` CLI options, in addition
  to the standard keys in `wrangler.toml`. Closes
  [issue #48](https://github.com/cloudflare/miniflare/issues/48), thanks
  [@PaganMuffin](https://github.com/PaganMuffin). See
  [📅 Compatibility Dates](https://miniflare.dev/core/compatibility) for more
  details.
- **Added a proper CommonJS module loader.** Workers built with Webpack will be
  more likely to work with Miniflare now. Closes
  [issue #44](https://github.com/cloudflare/miniflare/issues/44), thanks
  [@TimTinkers](https://github.com/TimTinkers).
- Don't crash on unhandled promise rejections when using the CLI. Instead, log
  them. Closes [issue #115](https://github.com/cloudflare/miniflare/issues/115),
  thanks [@togglydev](https://github.com/togglydev).
- Limit the number of
  [subrequests](https://developers.cloudflare.com/workers/platform/limits#subrequests)
  to 50,
  [as per the Workers runtime](https://developers.cloudflare.com/workers/platform/limits#account-plan-limits).
  Closes [issue #117](https://github.com/cloudflare/miniflare/issues/117),
  thanks [@leader22](https://github.com/leader22) for the suggestion.
- To match the behaviour of the Workers runtime, some functionality, such as
  asynchronous I/O (`fetch`, Cache API, KV), timeouts (`setTimeout`,
  `setInterval`), and generating cryptographically-secure random values
  (`crypto.getRandomValues`, `crypto.subtle.generateKey`), can now only be
  performed while handling a request.

  This behaviour can be disabled by setting the
  `--global-async-io`/`globalAsyncIO`, `--global-timers`/`globalTimers` and
  `--global-random`/`globalRandom` options respectively, which may be useful for
  tests or libraries that need async I/O for setup during local development.
  Note the Miniflare Jest environment automatically enables these options.

  KV namespaces and caches returned from `Miniflare#getKVNamespace()` and
  `getCaches()` are unaffected by this change, so they can still be used in
  tests without setting any additional options.

- To match the behaviour of the Workers runtime, Miniflare now enforces
  recursion depth limits. Durable Object `fetch`es can recurse up to 16 times,
  and service bindings can recurse up to 32 times. This means if a Durable
  Object fetch triggers another Durable Object fetch, and so on 16 times, an
  error will be thrown.
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
- Miniflare-added `CF-*` headers are now included in the HTML error response
- Updated build script to use ES module exports of dependencies where possible.
  Thanks [@lukeed](https://github.com/lukeed) for the
  [PR](https://github.com/cloudflare/miniflare/pull/77).

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
- Adds **highly experimental** support for
  [service bindings](https://blog.cloudflare.com/introducing-worker-services/#services-can-talk-to-each-other).
  This is primarily meant for internal testing, and users outside the beta can't
  deploy workers using this feature yet, but feel free to play around with them
  locally and let us know what you think in the
  [Cloudflare Workers Discord server](https://discord.gg/cloudflaredev).

  To enable these, mount your service (so Miniflare knows where to find it) then
  add the binding. Note the bound service name must match the mounted name:

  ```sh
  $ miniflare --mount auth=./auth --service AUTH_SERVICE=auth # or -S
  ```

  ```toml
  # wrangler.toml
  experimental_services = [
    # Note environment is currently ignored
    { name = "AUTH_SERVICE", service = "auth", environment = "production" }
  ]

  [miniflare.mounts]
  auth = "./auth"
  ```

  ```js
  const mf = new Miniflare({
    mounts: { auth: "./auth" },
    serviceBindings: { AUTH_SERVICE: "auth" },
  });
  ```

  ...then to use the service binding:

  ```js
  export default {
    async fetch(request, env, ctx) {
      const res = await env.AUTH_SERVICE.fetch("...");
      // ...
    },
  };
  ```

  If `./auth/wrangler.toml` contains its own service bindings, those services
  must also be mounted in the **root** worker (i.e. in `wrangler.toml` not
  `./auth/wrangler.toml`). Nested mounts are not supported.

**Builds:**

- When running your worker's build script, Miniflare will set the environment
  variable `MINIFLARE=1`. Closes
  [issue #65](https://github.com/cloudflare/miniflare/issues/65), thanks
  [@maraisr](https://github.com/maraisr).
- Added an alias, `-B`, for the `--build-command` option
- Multiple build watch paths can now be specified. If any of them change, your
  worker will rebuild and reload.
- Pass the `--env` flag to `wrangler build` when `--wrangler-env` is set for
  `type = "webpack"`/`"rust"` builds
- Fixed an issue where workers would not rebuild if the build watch path started
  with `./`. Closes
  [issue #53](https://github.com/cloudflare/miniflare/issues/53), thanks
  [@janat08](https://github.com/janat08).

**Standards:**

- **Added support for
  [`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)**
- **Added support for
  [`structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)**.
  Note the `transfer` option is only supported on Node.js >= 17.
- **Added support for
  [`queueMicrotask`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)**
- **Added support for the `NODE-ED25519` algorithm** to `crypto.subtle.sign()`
  and `crypto.subtle.verify()`
- Added support for `AbortSignal.timeout()`
- Added support for `crypto.DigestStream`
- Added support for `scheduler.wait()`
- Added support for `FixedLengthStream`. Closes
  [issue #123](https://github.com/cloudflare/miniflare/issues/123), thanks
  [@vlovich](https://github.com/vlovich).
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
- Added support for the
  [`Response#encodeBody` property](https://developers.cloudflare.com/workers/runtime-apis/response#properties).
  If this is omitted or set to `auto`, `Response`s with a `Content-Encoding`
  header that includes `gzip`, `deflate` or `br` will be automatically encoded.
  Closes [issue #72](https://github.com/cloudflare/miniflare/issues/72), thanks
  [@SupremeTechnopriest](https://github.com/SupremeTechnopriest).
- Return a non-`opaque` `Response` containing headers when fetching with a
  `redirect` mode set to `manual` in response to a redirect, closes
  [issue #133](https://github.com/cloudflare/miniflare/issues/133), thanks
  [@hansede](https://github.com/hansede),
  [@vzaramel](https://github.com/vzaramel) and
  [@hnrqer](https://github.com/hnrqer).
- Set the `redirect` mode of incoming requests to `manual`, matching the
  [behaviour of the Workers runtime](https://developers.cloudflare.com/workers/runtime-apis/request#requestinit)
- Remove extra headers not sent by Cloudflare Workers with `fetch` requests.
  Closes [issue #139](https://github.com/cloudflare/miniflare/issues/139),
  thanks [@dfcowell](https://github.com/dfcowell).
- `Request`/`Response` `body`s are now byte streams, allowing them to be read
  with bring-your-own-buffer readers
- Throw an error when attempting to construct a WebSocket response with a status
  other than `101`
- Throw an error when attempting to clone a WebSocket response
- Added support for the non-standard
  `ReadableStreamBYOBReader#readAtLeast(size, buffer)` method
- Include `File` in the Miniflare sandbox. Closes
  [issue #66](https://github.com/cloudflare/miniflare/issues/66), thanks
  [@tranzium](https://github.com/tranzium).

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
- Throw an error when values are greater than `128KiB`
- Throw an error when attempting to `get`, `put` or `delete` more than `128`
  keys, or when attempting to modify more than `128` keys in a transaction
- Throw an error when attempting to `put` an `undefined` value
- Throw an error when attempting to list keys with a negative `limit`
- Throw an error when attempting to perform an operation in a rolledback
  transaction or in a transaction that has already committed
- Throw an error when attempting to call `deleteAll()` in a transaction
- Throw an error when a Durable Object `fetch` handler doesn't return a
  `Response`
- Use the same V8 serialization as Cloudflare Workers to store values
- Fixed an issue where keys added in a transaction callback were not reported as
  deleted in the same transaction
- Fixed an issue where keys added in a transaction callback were not included in
  the list of keys in the same transaction

**HTMLRewriter:**

- Remove `Content-Length` header from `HTMLRewriter` transformed `Response`s
- Don't start transforming until transformed `Response` body is needed
- Throw an error when attempting to transform body streams containing
  non-ArrayBuffer/ArrayBufferView chunks

**HTTP Server:**

- **Added a live reload feature**, that automatically refreshes your browser
  when your worker reloads. For this to work, pass the `--live-reload` option,
  and return an HTML response containing a `<body>` tag with the `Content-Type`
  set to `text/html`. See
  [⚡️ Live Reload](https://miniflare.dev/developing/live-reload) for more
  details.

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

- Added `--open`/`-O` option that automatically opens your browser once your
  worker is running. You can optionally specify a different URL to open with
  `--open https://example.com`. Closes
  [issue #121](https://github.com/cloudflare/miniflare/issues/121), thanks
  [@third774](https://github.com/third774) for the suggestion.

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
  `convertNodeRequest(req, meta?)` function. You can import this from
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

**Jest Environment:**

- Added a custom Jest test environment, allowing you to run unit tests in the
  Miniflare sandbox, with isolated storage for each test. See
  [🤹 Jest Environment](https://miniflare.dev/testing/jest) for more details.

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
- Switched the CRON validation and scheduling package from
  [`node-cron`](https://www.npmjs.com/package/node-cron) to
  [`cron-schedule`](https://www.npmjs.com/package/cron-schedule). This improves
  error messages for invalid CRON expressions, and removes a transitive
  dependency on `moment-timezone`, reducing the installation size by 5MB.

**Workers Sites:**

- Added support for the new `__STATIC_CONTENT_MANIFEST` text module allowing you
  to use Workers Sites in modules mode

**Web Sockets:**

- Added support for **sending/receiving binary messages**. Closes
  [issue #67](https://github.com/cloudflare/miniflare/issues/67), thanks
  [@NostalgiaRunner](https://github.com/NostalgiaRunner).
- Removed the `WebSocket#readyState` property. Closes
  [issue #47](https://github.com/cloudflare/miniflare/issues/47), thanks
  [@aboodman](https://github.com/aboodman).
- Wait for worker response before opening WebSocket in client, closes
  [issue #88](https://github.com/cloudflare/miniflare/issues/88), thanks
  [@TimTinkers](https://github.com/TimTinkers).
- `http` and `https` protocols are now required for WebSocket upgrades via
  `fetch` as per the workers runtime
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
- Make WebSocket event constructors more spec-compliant

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
  [✉️ WebSockets](https://miniflare.dev/core/web-sockets) for more details.
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
  [✨ Cache](https://miniflare.dev/storage/cache#disabling) for more details.
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
  [📄 HTMLRewriter](https://miniflare.dev/core/html-rewriter) for more details.
- Added HTTPS support for local development, thanks
  [@RichiCoder1](https://github.com/RichiCoder1) for the
  [suggestion (#12)](https://github.com/cloudflare/miniflare/issues/12). See
  [💻 Using the CLI](https://miniflare.dev/get-started/cli#https-server) and
  [🧰 Using the API](https://miniflare.dev/get-started/api#https-server) for
  more details.
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
  [📦 KV](https://miniflare.dev/storage/kv#persistence),
  [✨ Cache](https://miniflare.dev/storage/cache#persistence) and
  [📌 Durable Objects](https://miniflare.dev/storage/durable-objects#persistence)
- Added support for loading scripts from `package.json`, closes
  [issue #7](https://github.com/cloudflare/miniflare/issues/7). See
  [💻 Using the CLI](https://miniflare.dev/get-started/cli#script-requirement)
  and
  [⚡️ Developing with esbuild](https://miniflare.dev/developing/esbuild#dependencies)
  for more details.
- Added `FormData` to the sandbox, closes
  [issue #6](https://github.com/cloudflare/miniflare/issues/6)
- Added an automatic update checker. See
  [💻 Using the CLI](https://miniflare.dev/get-started/cli#update-checker) for
  more details.
- [📚 Modules](https://miniflare.dev/core/modules) mode is now always enabled
  when specifying
  [📌 Durable Objects](https://miniflare.dev/storage/durable-objects##objects)
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
  [✨ Cache](https://miniflare.dev/storage/cache) for more details.

## 1.0.1

### Fixes

- Fixed
  `/usr/bin/env: 'node --experimental-vm-modules': No such file or directory`
  error when running the CLI in Linux. See
  [💻 Using the CLI](https://miniflare.dev/get-started/cli#usage) for more
  details.

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

- Added support for [📚 Modules](https://miniflare.dev/core/modules) (requires
  `--experimental-vm-modules` flag)
- Added support for
  [📌 Durable Objects](https://miniflare.dev/storage/durable-objects)
- Added support for [✉️ Web Sockets](https://miniflare.dev/core/web-sockets)
  (client and server)
- Added support for [🛠 Builds](https://miniflare.dev/developing/builds) (custom
  builds and `webpack`/`rust` Wrangler builds)
- Added support for [⚙️ WebAssembly](https://miniflare.dev/core/web-assembly)
- Added support for [📄 HTMLRewriter](https://miniflare.dev/core/html-rewriter)
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
  [⏰ Scheduled Events](https://miniflare.dev/core/scheduled)
- Added manual triggering for
  [⏰ Scheduled Events](https://miniflare.dev/core/scheduled) via
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

- Added support for [📨 Fetch Events](https://miniflare.dev/core/fetch)
- Added support for [⏰ Scheduled Events](https://miniflare.dev/core/scheduled)
- Added support for
  [🔑 Variables and Secrets](https://miniflare.dev/core/variables-secrets)
- Added support for [📦 KV](https://miniflare.dev/storage/kv)
- Added support for [✨ Cache](https://miniflare.dev/storage/cache)
- Added support for [🌐 Workers Sites](https://miniflare.dev/storage/sites)
- Added support for
  [🗺 Source Maps](https://miniflare.dev/developing/source-maps)
