# ✨ Cache

## Default Cache

Access to the default cache is enabled by default:

```js
addEventListener("fetch", (e) => {
  e.respondWith(caches.default.match("http://miniflare.pages.dev"));
});
```

## Persistence

By default, cached data is stored in memory. It will persist between reloads,
but not CLI invocations or different `Miniflare` instances. To enable
persistence to the file system, specify the cache persistence option:

```shell
$ miniflare --cache-persist # Defaults to ./mf/cache
$ miniflare --cache-persist ./data/  # Custom path
```

```toml
# wrangler.toml
cache_persist = true # Defaults to ./mf/cache
cache_persist = "./data/" # Custom path
```

```js
const mf = new Miniflare({
  cachePersist: true, // Defaults to ./mf/cache
  cachePersist: "./data", // Custom path
});
```

## Manipulating Outside Workers

For testing, it can be useful to put/match data from cache outside a worker. You
can do this with the `getCache` method:

```js{23-31}
import { Miniflare, Response } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request) {
      const url = new URL(request.url);
      const cache = caches.default;
      if(url.pathname === "/put") {
        await cache.put("https://miniflare.pages.dev/", new Response("1", {
          headers: { "Cache-Control": "max-age=3600" },
        }));
      }
      return cache.match("https://miniflare.pages.dev/");
    }
  }
  `,
});
let res = await mf.dispatchFetch("http://localhost:8787/put");
console.log(await res.text()); // 1

const cache = await mf.getCache();
const cachedRes = await cache.match("https://miniflare.pages.dev/");
console.log(await cachedRes.text()); // 1

await cache.put(
  "https://miniflare.pages.dev",
  new Response("2", {
    headers: { "Cache-Control": "max-age=3600" },
  })
);
res = await mf.dispatchFetch("http://localhost:8787");
console.log(await res.text()); // 2
```
