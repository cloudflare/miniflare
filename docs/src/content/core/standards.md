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
import { Miniflare, createFetchMock } from "miniflare";

// Create `MockAgent` and connect it to the `Miniflare` instance
const fetchMock = createFetchMock();
const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request, env, ctx) {
      const res = await fetch("https://example.com/thing");
      const text = await res.text();
      return new Response(\`response:\${text}\`);
    }
  }
  `,
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

Miniflare does not support limiting the amount of
[subrequests](https://developers.cloudflare.com/workers/platform/limits#account-plan-limits).
Please keep this in mind if you make a large amount of subrequests from your
Worker.

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

try {
  await mf.dispatchFetch("http://localhost");
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
