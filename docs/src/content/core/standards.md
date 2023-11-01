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
  `Request`, `Response`, `FormData`, `Blob`, `File`, `URL`, `URLPattern`,
  `URLSearchParams` (powered by [`undici`](https://github.com/nodejs/undici/))
- **Streams:** `ByteLengthQueuingStrategy`, `CountQueuingStrategy`,
  `ReadableByteStreamController`, `ReadableStream`, `ReadableStreamBYOBReader`
  (including non-standard `readAtLeast` method), `ReadableStreamBYOBRequest`,
  `ReadableStreamDefaultController`, `ReadableStreamDefaultReader`,
  `TransformStream`, `TransformStreamDefaultController`, `WritableStream`,
  `WritableStreamDefaultController`, `WritableStreamDefaultWriter`,
  `IdentityTransformStream`, `FixedLengthStream`, `CompressionStream`,
  `DecompressionStream`, `TextEncoderStream`, `TextDecoderStream`
- **Events:** `Event`, `EventTarget`, `AbortController`, `AbortSignal`
- **Event Types:** `fetch`, `scheduled`, `unhandledrejection`,
  `rejectionhandled`
- **Misc:** `structuredClone`, `navigator`

## Mocking Outbound `fetch` Requests

When using the API, Miniflare allows you to substitute custom `Response`s for
`fetch()` calls using `undici`'s
[`MockAgent` API](https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin).
This is useful for testing workers that make HTTP requests to other services. To
enable `fetch` mocking, create a
[`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin)
using the `createFetchMock()` function, then set this using the `fetchMock`
option. If you're using the
[🤹 Jest Environment](/testing/jest#mocking-outbound-fetch-requests), use the
global `getMiniflareFetchMock()` function to obtain a correctly set-up
[`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin).

```js
import { Miniflare } from "miniflare";
import { createFetchMock } from "@miniflare/core";

// Create `MockAgent` and connect it to the `Miniflare` instance
const fetchMock = createFetchMock();
const mf = new Miniflare({
  script: `export default {
    async fetch(request, env, ctx) {
      const res = await fetch("https://example.com/thing");
      const text = await res.text();
      return new Response(\`response:\${text}\`);
    }
  }`,
  modules: true,
  fetchMock,
});

// Throw when no matching mocked request is found
// (see https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentdisablenetconnect)
fetchMock.disableNetConnect();

// Mock request to https://example.com/thing
// (see https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin)
const origin = fetchMock.get("https://example.com");
// (see https://undici.nodejs.org/#/docs/api/MockPool?id=mockpoolinterceptoptions)
origin
  .intercept({ method: "GET", path: "/thing" })
  .reply(200, "Mocked response!");

const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // "response:Mocked response!"
```

## Subrequests

To match the behaviour of the Workers runtime, Miniflare limits you to
[50 subrequests per request](https://developers.cloudflare.com/workers/platform/limits#account-plan-limits).
Each call to `fetch()`, each URL in a redirect chain, and each call to a Cache
API method (`put()`/`match()`/`delete()`) counts as a subrequest.

If needed, the subrequest limit to be customised using the
`MINIFLARE_SUBREQUEST_LIMIT` environment variable. Setting this to a negative
number disables the limit. Setting this to 0 disables subrequests.

## Frozen Time

To match the
[behaviour of the Workers runtime](https://developers.cloudflare.com/workers/learning/security-model/#step-1-disallow-timers-and-multi-threading),
Miniflare will always return the time of last I/O from `new Date()` and
`Date.now()`.

This behaviour can be disabled by setting the `actualTime` option, which may be
useful for performance testing.

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[miniflare]
actual_time = true
```

```js
const mf = new Miniflare({
  actualTime: true,
});
```

</ConfigTabs>

## Global Functionality Limits

To match the
[behaviour of the Workers runtime](https://developers.cloudflare.com/workers/runtime-apis/request/#the-request-context),
some functionality, such as asynchronous I/O (`fetch`, Cache API, KV), timeouts
(`setTimeout`, `setInterval`), and generating cryptographically-secure random
values (`crypto.getRandomValues`, `crypto.subtle.generateKey`), can only be
performed while handling a request, not in the global scope.

KV namespaces and caches returned from `Miniflare#getKVNamespace()` and
`Miniflare#getCaches()` are unaffected by this limit, so they can still be used
in tests without setting any additional options.

## `instanceof`, `constructor` and `prototype` Checks

Miniflare overrides `instanceof` checks for primitive classes like `Object` so
they succeed for values created both inside and outside the Miniflare sandbox
(in a different JavaScript realm). This ensures dynamic type checking often
performed by WebAssembly glue code (e.g. `wasm-bindgen`) always succeeds. Note
that values returned by Workers runtime APIs are created outside the Miniflare
sandbox. See
[this file](https://github.com/cloudflare/miniflare/blob/master/packages/runner-vm/src/instanceof.ts)
for more details.

Primitive classes in this case are defined as JavaScript built-ins that can be
instantiated by something other than their constructor (e.g. literals,
`function`s, runtime errors):

- `Object`
- `Function`
- `Array`
- `Promise`
- `RegExp`
- `Error`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`,
  `TypeError`, `URIError`

Primitive `constructor` and `prototype` checks cannot be trapped easily and so
will fail for values created outside the Miniflare sandbox.

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  bindings: {
    OBJECT: { a: 1 },
    ARRAY: new Uint8Array([1, 2, 3]),
  },
  modules: true,
  script: `
    export default {
      async fetch(request, env, ctx) {
        console.log({ a: 1 } instanceof Object); // ✅ true
        console.log(new Uint8Array([1, 2, 3]) instanceof Object); // ✅ true
        console.log({ a: 1 }.constructor === Object); // ✅ true
        console.log(Object.getPrototypeOf({ a: 1 }) === Object.prototype); // ✅ true
        
        console.log(env.OBJECT instanceof Object); // ✅ true
        console.log(env.ARRAY instanceof Object); // ✅ true
        console.log(env.OBJECT.constructor === Object); // ❌ false
        console.log(Object.getPrototypeOf(env.OBJECT) === Object.prototype); // ❌ false
        
        throw new Error("oops!");
      }
    }
  `,
});

const fetcher = await mf.getWorker();

try {
  await fetcher.fetch("http://localhost");
} catch (e) {
  console.log(e instanceof Error); // ❌ false
}
```

By default, primitive `instanceof` checks outside the Miniflare sandbox will
fail for values created inside the sandbox (e.g. checking types of thrown
exceptions in tests). To fix this, pass the primitive class in from Node.js as a
custom global. Note this will cause primitive `instanceof` checks to fail for
values created without the constructor inside the sandbox.

```js
const mf = new Miniflare({
  modules: true,
  script: `
    export default {
      async fetch(request, env, ctx) {
        throw new Error("oops!");
      }
    }
  `,
});

try {
  await mf.dispatchFetch("http://localhost");
} catch (e) {
  console.log(e instanceof Error); // ✅ true
}
```
