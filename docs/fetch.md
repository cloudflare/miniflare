# 📨 Fetch Events

- [`FetchEvent` Reference](https://developers.cloudflare.com/workers/runtime-apis/fetch-event)
- [`FetchEvent` Lifecycle](https://developers.cloudflare.com/workers/learning/fetch-event-lifecycle)
- [`addEventListener` Reference](https://developers.cloudflare.com/workers/runtime-apis/add-event-listener)

## HTTP Requests

When using the CLI, an HTTP server is automatically started. Whenever an HTTP
request is made, it is converted to a workers-compatible `Request` object,
dispatched to your worker, then the generated `Response` is returned. The
`Request` object will include
[`CF-*` headers](https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-)
and a
[`cf` object](https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties).
Miniflare will log the method, path, status, the time it took to respond, and
the time taken for all `waitUntil` promises to resolve.

If the worker throws an error whilst generating a response, an error page
containing the stack trace is returned instead. You can use
[🗺 Source Maps](/source-maps.html) to make these point to your source files.

## Dispatching Events

When using the API, the `dispatchFetch` function can be used to dispatch `fetch`
events to your worker. This can be used for testing responses. `dispatchFetch`
has the same API as the regular `fetch` method: it either takes a `Request`
object, or a URL and optional `RequestInit` object:

```js
import { Miniflare, Request } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    const body = JSON.stringify({
      url: event.request.url,
      header: event.request.headers.get("X-Message"),
    });
    event.respondWith(new Response(body, {
      headers: { "Content-Type": "application/json" },
    }));
  });
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

You can use the `waitUntil` method of `Response` to get the data returned by all
waited promises:

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.waitUntil(Promise.resolve(1));
    event.waitUntil(Promise.resolve("2"));
    event.respondWith(new Response());
  });
  `,
});
const res = await mf.dispatchFetch("http://localhost:8787/");
const waitUntil = await res.waitUntil();
console.log(waitUntil[0]); // 1
console.log(waitUntil[1]); // "2"
```

## Upstream

Miniflare will call each `fetch` listener until a response is returned. If no
response is returned, or an exception is thrown and `passThroughOnException()`
has been called, the response will be fetched from the specified upstream
instead:

```shell
$ miniflare --upstream https://miniflare.dev # or -u
```

```toml
# wrangler.toml
[miniflare]
upstream = "https://miniflare.dev"
```

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
// MUST use same upstream URL when dispatching
const res = await mf.dispatchFetch("https://miniflare.dev/fetch.html");
console.log(await res.text()); // Source code of this page
```
