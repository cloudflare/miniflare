# 📦 KV

## Namespaces

Specify KV namespaces to add to your environment as follows:

```shell
$ miniflare --kv TEST_NAMESPACE1 --kv TEST_NAMESPACE2 # or -k
```

```toml
# wrangler.toml
kv_namespaces = [
  { binding = "TEST_NAMESPACE1", id = "<ignored>", preview_id = "<ignored>" },
  { binding = "TEST_NAMESPACE2", id = "<ignored>", preview_id = "<ignored>" }
]
```

```js
const mf = new Miniflare({
  kvNamespaces: ["TEST_NAMESPACE1", "TEST_NAMESPACE2"],
});
```

You can now access KV namespaces in your workers:

```js
addEventListener("fetch", (e) => {
  e.respondWith(
    TEST_NAMESPACE1.get("key").then((value) => new Response(value))
  );
});
```

```js
export default {
  async fetch(request, env) {
    return new Response(await env.TEST_NAMESPACE1.get("key"));
  },
};
```

## Persistence

By default, KV data is stored in memory. It will persist between reloads, but
not CLI invocations or different `Miniflare` instances. To enable persistence to
the file system, specify the KV persistence option:

```shell
$ miniflare --kv-persist # Defaults to ./mf/kv
$ miniflare --kv-persist ./data/  # Custom path
```

```toml
# wrangler.toml
kv_persist = true # Defaults to ./mf/kv
kv_persist = "./data/" # Custom path
```

```js
const mf = new Miniflare({
  kvPersist: true, // Defaults to ./mf/kv
  kvPersist: "./data", // Custom path
});
```

Each namespace will get its own directory within the KV persistence directory.
Key names are sanitised before data is read/written. Metadata is stored in files
with a `.meta.json` suffix. These also contain original key names, so they can
be returned when listing keys.

## Manipulating Outside Workers

For testing, it can be useful to set/get data from KV outside a worker. You can
do this with the `getKVNamespace` method:

```js{17-18,22}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request, env, ctx) {
      const value = parseInt(await env.TEST_NAMESPACE.get("count")) + 1;
      await env.TEST_NAMESPACE.put("count", value.toString());
      return new Response(value.toString());
    },
  }
  `,
  kvNamespaces: ["TEST_NAMESPACE"],
});

const ns = await mf.getKVNamespace("TEST_NAMESPACE");
await ns.put("count", "1");

const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // 2
console.log(await ns.get("count")); // 2
```
