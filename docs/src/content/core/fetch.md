---
order: 0
---

# 📨 Fetch Events

- [`FetchEvent` Reference](https://developers.cloudflare.com/workers/runtime-apis/fetch-event)
- [`FetchEvent` Lifecycle](https://developers.cloudflare.com/workers/learning/fetch-event-lifecycle)
- [`addEventListener` Reference](https://developers.cloudflare.com/workers/runtime-apis/add-event-listener)

## HTTP Requests

Whenever an HTTP request is made, a `Request` object is dispatched to your worker, then the generated `Response` is returned. The
`Request` object will include a
[`cf` object](https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties).
Miniflare will log the method, path, status, and the time it took to respond.

If the worker throws an error whilst generating a response, an error page
containing the stack trace is returned instead. You can use
[🗺 Source Maps](/developing/source-maps) to make these point to your source
files.

## Dispatching Events

When using the API, the `dispatchFetch` function can be used to dispatch `fetch`
events to your worker. This can be used for testing responses. `dispatchFetch`
has the same API as the regular `fetch` method: it either takes a `Request`
object, or a URL and optional `RequestInit` object:

```js
import { Miniflare, Request } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request, env, ctx) {
      const body = JSON.stringify({
        url: event.request.url,
        header: event.request.headers.get("X-Message"),
      });
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      });
    })
  }
  `,
});

let res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.json()); // { url: "http://localhost:8787/", header: null }

res = await mf.dispatchFetch("http://localhost:8787/1", {
  headers: { "X-Message": "1" },
});
console.log(await res.json()); // { url: "http://localhost:8787/1", header: "1" }

res = await mf.dispatchFetch(
  new Request("http://localhost:8787/2", {
    headers: { "X-Message": "2" },
  })
);
console.log(await res.json()); // { url: "http://localhost:8787/2", header: "2" }
```

When dispatching events, you are responsible for adding
[`CF-*` headers](https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-)
and the
[`cf` object](https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties).
This lets you control their values for testing:

```js
const res = await mf.dispatchFetch("http://localhost:8787", {
  headers: {
    "CF-IPCountry": "GB",
  },
  cf: {
    country: "GB",
  },
});
```

## Upstream

Miniflare will call each `fetch` listener until a response is returned. If no
response is returned, or an exception is thrown and `passThroughOnException()`
has been called, the response will be fetched from the specified upstream
instead:

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.passThroughOnException();
    throw new Error();
  });
  `,
  upstream: "https://miniflare.dev",
});
// If you don't use the same upstream URL when dispatching, Miniflare will
// rewrite it to match the upstream
const res = await mf.dispatchFetch("https://miniflare.dev/core/fetch");
console.log(await res.text()); // Source code of this page
```
