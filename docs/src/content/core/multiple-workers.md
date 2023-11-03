---
order: 9
---

# 🔌 Multiple Workers

Miniflare allows you to run multiple workers in the same instance. All Workers can be defined at the same level, using the `workers` option.

Here's an example that uses a service binding to increment a value in a shared KV namespace:

```js
import { Miniflare, Response } from "miniflare";

const message = "The count is ";
const mf = new Miniflare({
  // Options shared between workers such as HTTP and persistence configuration
  // should always be defined at the top level.
  host: "0.0.0.0",
  port: 8787,
  kvPersist: true,

  workers: [
    {
      name: "worker",
      kvNamespaces: { COUNTS: "counts" },
      serviceBindings: {
        INCREMENTER: "incrementer",
        // Service bindings can also be defined as custom functions, with access
        // to anything defined outside Miniflare.
        async CUSTOM(request) {
          // `request` is the incoming `Request` object.
          return new Response(message);
        },
      },
      modules: true,
      script: `export default {
        async fetch(request, env, ctx) {
          // Get the message defined outside
          const response = await env.CUSTOM.fetch("http://host/");
          const message = await response.text();

          // Increment the count 3 times
          await env.INCREMENTER.fetch("http://host/");
          await env.INCREMENTER.fetch("http://host/");
          await env.INCREMENTER.fetch("http://host/");
          const count = await env.COUNTS.get("count");

          return new Response(message + count);
        }
      }`,
    },
    {
      name: "incrementer",
      // Note we're using the same `COUNTS` namespace as before, but binding it
      // to `NUMBERS` instead.
      kvNamespaces: { NUMBERS: "counts" },
      // Worker formats can be mixed-and-matched
      script: `addEventListener("fetch", (event) => {
        event.respondWith(handleRequest());
      })
      async function handleRequest() {
        const count = parseInt((await NUMBERS.get("count")) ?? "0") + 1;
        await NUMBERS.put("count", count.toString());
        return new Response(count.toString());
      }`,
    },
  ],
});
const res = await mf.dispatchFetch("http://localhost");
console.log(await res.text()); // "The count is 3"
await mf.dispose();
```

## Routing

You can enable routing by specifying routes in a worker's `wrangler.toml` file or via the API,
using the
[standard route syntax](https://developers.cloudflare.com/workers/platform/routes#matching-behavior).
Note port numbers are ignored:

```toml
---
filename: api/wrangler.toml
---
# Miniflare will load routes from any of these options

route = "https://example.com/api/*"
routes = ["example.com/v1/*", "example.com/v2/*"]

# Miniflare supports Wrangler2 routes. Zones are ignored
route = {pattern = "https://example.com/api/*", zone_name="<ignored>"}
routes = [{pattern = "example.com/v1/*", zone_name="<ignored>"}, {pattern = "example.com/v2/*", zone_id = "<ignored>"}]

# Only loaded if the wrangler.toml environment is set to "dev"
[env.dev]
route = "miniflare.test/api/*"
routes = ["miniflare.test/v1/*", "miniflare.test/v2/*"]
```

```js
const mf = new Miniflare({
  workers: [{
    scriptPath: "./api/worker.js",
    routes: ["http://127.0.0.1/api*", "api.mf/*"],
    },
  },
});
```

The parent worker is always used as a fallback if no mounts' routes match. If
the parent worker has a `name` set, and it has more specific routes than other
mounts, they'll be used instead.

<ConfigTabs>

```sh
$ miniflare --name worker --route http://127.0.0.1/parent*
```

```toml
---
filename: wrangler.toml
---
name = "worker"
route = "http://127.0.0.1/parent*"
```

```js
const mf = new Miniflare({
  name: "worker",
  routes: ["http://127.0.0.1/parent*"],
});
```

</ConfigTabs>

When using the CLI with hostnames that aren't `localhost` or `127.0.0.1`, you
may need to edit your computer's `hosts` file, so those hostnames resolve to
`localhost`. On Linux and macOS, this is usually at `/etc/hosts`. On Windows,
it's at `C:\Windows\System32\drivers\etc\hosts`. For the routes above, we would
need to append the following entries to the file:

```
127.0.0.1 miniflare.test
127.0.0.1 api.mf
```

Alternatively, you can customise the `Host` header when sending the request:

```sh
# Dispatches to the "api" worker
$ curl "http://localhost:8787/todos/update/1" -H "Host: api.mf"
```

When using the API, Miniflare will use the request's URL to determine which
worker to dispatch to.

```js
// Dispatches to the "api" worker
const res = await mf.dispatchFetch("http://api.mf/todos/update/1", { ... });
```

Note that if [an upstream is specified](/core/fetch#upstream), Miniflare will
use the incoming request's URL for route matching, but then replace it and the
`Host` header with the upstream:

```js
const mf = new Miniflare({
  mounts: {
    api: {
      script: `export default {
        async fetch(request) {
          return new Response("URL: " + request.url + " Host: " + request.headers.get("Host"));
        }
      }`,
      modules: true,
      upstream: "https://example.com/api/",
      routes: ["api.mf/*"],
    },
  },
});
const res = await mf.dispatchFetch("http://api.mf/todos/update/1", {
  headers: { Host: "api.mf" },
});
console.log(await res.text()); // URL: https://example.com/api/todos/update/1 Host: example.com
```

## Durable Objects

Miniflare supports the `script_name` option for accessing Durable Objects
exported by other scripts. See
[📌 Durable Objects](/storage/durable-objects#using-a-class-exported-by-another-script)
for more details.
