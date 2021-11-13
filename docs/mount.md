# 🔌 Multiple Workers

## Mounting Workers

Miniflare allows you to run multiple workers in the same instance. Assuming the
following directory structure:

```
├── api
│   ├── api-worker.js   // addEventListener("fetch", ...)
│   ├── package.json    // { "main": "./api-worker.js" }
│   └── wrangler.toml   // name = "api"
├── site
│   ├── package.json    // { "module": "./site-worker.mjs" }
│   ├── site-worker.mjs // export default { ... }
│   └── wrangler.toml   // name = "site" [build.upload] format = "modules"
├── package.json
├── worker.js
└── wrangler.toml
```

...you can mount the `api` and `site` workers with:

```shell
$ miniflare --mount api=./api --mount site=./site
```

```toml
# wrangler.toml
[miniflare.mounts]
api = "./api"
site = "./site"
```

```js
const mf = new Miniflare({
  mounts: {
    api: "./api",
    site: "./site",
  },
});
```

Note the **mounted paths, `./api` and `./site`, are paths to directories not
worker scripts**. All worker configuration must be derivable from
`package.json`, `.env` and `wrangler.toml` files in these directories when
mounting like this. None of the configuration from the parent worker (aside from
the `watch` option) is copied to mounted workers.

When using the API, you can instead configure the mounted workers using the same
options as the `new Miniflare` constructor. Note that nested `mounts` are not
supported: 🙃

```js
const mf = new Miniflare({
  mounts: {
    api: {
      scriptPath: "./api/api-worker.js",
      kvNamespaces: ["TEST_NAMESPACE"],
    },
  },
});
```

## Fetching

When dispatching events (either via `dispatchFetch` or the HTTP(S) server), if
the path starts with the mounted name (e.g. `/api` or `/site/`), this prefix
will be stripped and the event will be dispatched to the mounted worker instead
of the parent:

```js
// api/api-worker.js
addEventListener("fetch", (event) => {
  event.respondWith(new Response(`res:${event.request.url}`));
});
```

```shell
$ curl "http://localhost:8787/api/todos/update/1"
res:http://localhost:8787/todos/update/1 # /api removed
```

## Durable Objects

Miniflare supports the `script_name` option for accessing Durable Objects
exported by other scripts. See
[📌 Durable Objects](/durable-objects.html#using-a-class-exported-by-another-script)
for more details.
