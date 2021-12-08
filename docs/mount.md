# 🔌 Multiple Workers

<!--prettier-ignore-start-->
:::warning
⚠️ Multiple worker support is experimental. There may be breaking changes in the future.
:::
<!--prettier-ignore-end-->

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

...you can mount the `api` and `site` workers (using the `dev` environment in
`site`'s `wrangler.toml`) with:

```shell
$ miniflare --mount api=./api --mount site=./site@dev
```

```toml
# wrangler.toml
[miniflare.mounts]
api = "./api"
site = "./site@dev"
```

```js
const mf = new Miniflare({
  mounts: {
    api: "./api",
    site: {
      rootPath: "./site",
      wranglerConfigPath: true,
      wranglerConfigEnv: "dev",
      packagePath: true,
      envPath: true,
    },
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
      rootPath: "./api",
      scriptPath: "./api-worker.js",
      kvNamespaces: ["TEST_NAMESPACE"],
    },
  },
});
```

## Routing

By default, mounted workers are not accessible. You can enable routing by
specifying routes in the mounted worker's `wrangler.toml` file or via the API,
using the
[standard route syntax](https://developers.cloudflare.com/workers/platform/routes#matching-behavior).
Note port numbers are ignored:

```toml
# api/wrangler.toml

# Miniflare will load routes from any of these options

route = "https://example.com/api/*"
routes = ["example.com/v1/*", "example.com/v2/*"]

# Only loaded if the wrangler.toml environment is set to "dev"
[env.dev]
route = "miniflare.test/api/*"
routes = ["miniflare.test/v1/*", "miniflare.test/v2/*"]

# Only loaded by Miniflare, ignored when deploying
[miniflare]
route = "http://127.0.0.1/api*"
routes = ["api.mf/*"]
```

```js
const mf = new Miniflare({
  mounts: {
    api: {
      rootPath: "./api",
      wranglerConfigPath: true,
      packagePath: true,
      envPath: true,
      routes: ["http://127.0.0.1/api*", "api.mf/*"],
    },
  },
});
```

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

```shell
# Dispatches to the "api" worker
$ curl "http://localhost:8787/todos/update/1" -H "Host: api.mf"
```

When using the API, Miniflare will use the request's URL to determine which
worker to dispatch to.

```js
// Dispatches to the "api" worker
const res = await mf.dispatchFetch("http://api.mf/todos/update/1", { ... });
```

Note that if [an upstream is specified](/fetch.html#upstream), Miniflare will
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
[📌 Durable Objects](/durable-objects.html#using-a-class-exported-by-another-script)
for more details.
