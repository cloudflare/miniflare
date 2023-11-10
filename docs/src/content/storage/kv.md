---
order: 0
---

# 📦 KV

- [KV Reference](https://developers.cloudflare.com/workers/runtime-apis/kv)

## Namespaces

Specify KV namespaces to add to your environment as follows:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
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

</ConfigTabs>

You can now access KV namespaces in your workers:

```js
---
header: Service Worker
---
addEventListener("fetch", (event) => {
  event.respondWith(
    TEST_NAMESPACE1.get("key").then((value) => new Response(value))
  );
});
```

```js
---
header: Modules
---
export default {
  async fetch(request, env) {
    return new Response(await env.TEST_NAMESPACE1.get("key"));
  },
};
```

Miniflare supports all KV operations and data types. Whilst it accepts the
`cacheTtl` options, it is ignored since there's only one "edge location" (the
user's computer) so it doesn't really mean anything.

## Validation

Like the real Workers runtime, Miniflare will throw errors when:

- Keys are empty, `.`, `..`, `undefined`, or greater than `512B` when UTF-8
  encoded
- Values are greater than `25MiB`
- Metadata is greater than `1KiB`
- The `cacheTtl` option is less than `60s`
- The `expirationTtl` option is non-numeric, less than or equal 0, or less than
  `60s`
- The `expiration` option is non-numeric, less than or equal the current time,
  or less than `60s` in the future
- The `limit` passed to `KVNamespace#list()` is non-numeric, less than or equal
  `0`, or greater than `1000`

## Manipulating Outside Workers

For testing, it can be useful to put/get data from KV outside a worker. You can
do this with the `getKVNamespace` method:

```js
---
highlight: [17,18,22]
---
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
