---
order: 6
---

# 🕸 Web Standards

- [Web Standards Reference](https://developers.cloudflare.com/workers/runtime-apis/web-standards)
- [Encoding Reference](https://developers.cloudflare.com/workers/runtime-apis/encoding)
- [Fetch Reference](https://developers.cloudflare.com/workers/runtime-apis/fetch)
- [Request Reference](https://developers.cloudflare.com/workers/runtime-apis/request)
- [Response Reference](https://developers.cloudflare.com/workers/runtime-apis/response)
- [Streams Reference](https://developers.cloudflare.com/workers/runtime-apis/streams)
- [Using Streams](https://developers.cloudflare.com/workers/learning/using-streams)
- [Web Crypto Reference](https://developers.cloudflare.com/workers/runtime-apis/web-crypto)

Miniflare supports the following Web Standards in its sandbox:

- **Console:** `console.*`
- **Timers:** `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`,
  `queueMicrotask`, `AbortSignal.timeout`, `scheduler.wait`
- **Base64:** `atob`, `btoa`
- **Web Crypto**: `crypto.getRandomValues`, `crypto.randomUUID`,
  `crypto.subtle.*` (with support for `MD5` digests and `NODE-ED25519`
  signatures), `crypto.DigestStream`
- **Encoding:** `TextEncoder`, `TextDecoder`
- **Fetch:** `fetch`, `Headers` (including
  [non-standard `getAll` method](https://developers.cloudflare.com/workers/runtime-apis/headers#differences)),
  `Request`, `Response`, `FormData`, `Blob`, `File`, `URL`, `URLSearchParams`
  (powered by [`undici`](https://github.com/nodejs/undici/))
- **Streams:** `ByteLengthQueuingStrategy`, `CountQueuingStrategy`,
  `ReadableByteStreamController`, `ReadableStream`, `ReadableStreamBYOBReader`
  (including non-standard `readAtLeast` method), `ReadableStreamBYOBRequest`,
  `ReadableStreamDefaultController`, `ReadableStreamDefaultReader`,
  `TransformStream`, `TransformStreamDefaultController`, `WritableStream`,
  `WritableStreamDefaultController`, `WritableStreamDefaultWriter`,
  `FixedLengthStream`
- **Events:** `Event`, `EventTarget`, `AbortController`, `AbortSignal`
- **Event Types:** `fetch`, `scheduled`, `unhandledrejection`,
  `rejectionhandled`
- **Misc:** `structuredClone`

## Subrequests

Like the real workers runtime, Miniflare limits you to
[50 subrequests per request](https://developers.cloudflare.com/workers/platform/limits#account-plan-limits).
Each call to `fetch()`, each URL in a redirect chain, and each call to a Cache
API method (`put()`/`match()`/`delete()`) counts as a subrequest.

If needed, the subrequest limit to be customised using the
`MINIFLARE_SUBREQUEST_LIMIT` environment variable. Setting this to a negative
number disables the limit. Setting this to 0 disables subrequests.

```sh
$ MINIFLARE_SUBREQUEST_LIMIT=100 miniflare
```

## Global Functionality Limits

To match the behaviour of the Workers runtime, some functionality, such as
asynchronous I/O (`fetch`, Cache API, KV), timeouts (`setTimeout`,
`setInterval`), and generating cryptographically-secure random values
(`crypto.getRandomValues`, `crypto.subtle.generateKey`), can only be performed
while handling a request, not in the global scope.

This behaviour can be disabled by setting the `globalAsyncIO`, `globalTimers`
and `globalRandom` options respectively, which may be useful for tests or
libraries that need async I/O for setup during local development. Note that the
Miniflare [🤹 Jest Environment](/testing/jest) automatically enables these
options.

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --global-async-io --global-timers --global-random
```

```toml
---
filename: wrangler.toml
---
[miniflare]
global_async_io = true
global_timers = true
glboal_random = true
```

```js
const mf = new Miniflare({
  globalAsyncIO: true,
  globalTimers: true,
  globalRandom: true,
});
```

</ConfigTabs>

KV namespaces and caches returned from `Miniflare#getKVNamespace()` and
`Miniflare#getCaches()` are unaffected by this limit, so they can still be used
in tests without setting any additional options.
