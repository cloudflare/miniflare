---
order: 1
---

# 📌 Durable Objects

- [Durable Objects Reference](https://developers.cloudflare.com/workers/runtime-apis/durable-objects)
- [Using Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects)

## Objects

Specify Durable Objects to add to your environment as follows:

```js
const mf = new Miniflare({
  modules: true,
  script: `
  export class Object1 {
    async fetch(request) {
      ...
    }
  }
  export default {
    fetch(request) {
      ...
    }
  }
  `,
  durableObjects: {
    // Note Object1 is exported from main (string) script
    OBJECT1: "Object1",
  },
});
```

## Persistence

By default, Durable Object data is stored in memory. It will persist between
reloads, but not different `Miniflare` instances. To enable persistence to the
file system or Redis, specify the Durable Object persistence option:

```js
const mf = new Miniflare({
  durableObjectsPersist: true, // Defaults to ./.mf/do
  durableObjectsPersist: "./data", // Custom path
  durableObjectsPersist: "redis://localhost:6379", // Redis server
});
```

When using the file system, each object instance will get its own directory
within the Durable Object persistence directory.

## Validation

Like the real Workers runtime, Miniflare will throw errors when:

- The string passed to `DurableObjectNamespace#idFromString(hexId)` is not 64
  hex digits
- The hex-ID passed to `DurableObjectNamespace#idFromString(hexId)` is for a
  different Durable Object
- The ID passed to `DurableObjectNamespace#get(id)` is for a different Durable
  Object
- Keys are greater than `2KiB` or `undefined`
- Values are greater than `128KiB`
- Attempting to `get`, `put` or `delete` more than `128` keys
- Attempting to modify more than `128` keys in a transaction
- Attempting to `put` an `undefined` value
- Attempting to list keys with a negative `limit`
- Attempting to list keys with both `start` and `startAfter` set
- Attempting to perform an operation in a rolledback transaction or in a
  transaction that has already committed
- Attempting to call `deleteAll()` in a transaction
- Attempting to recurse more than 16 levels deep with Durable Object `fetch`es

## Manipulating Outside Workers

For testing, it can be useful to make requests to your Durable Objects from
outside a worker. You can do this with the `getDurableObjectNamespace` method.

```js
---
highlight: [28,29,30,31,32]
---
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  durableObjects: { TEST_OBJECT: "TestObject" },
  script: `
  export class TestObject {
    constructor(state) {
      this.storage = state.storage;
    }

    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/put") await this.storage.put("key", 1);
      return new Response((await this.storage.get("key")).toString());
    }
  }

  export default {
    async fetch(request, env) {
      const stub = env.TEST_OBJECT.get(env.TEST_OBJECT.idFromName("test"));
      return stub.fetch(request);
    }
  }
  `,
});

const ns = await mf.getDurableObjectNamespace("TEST_OBJECT");
const id = ns.idFromName("test");
const stub = ns.get(id);
const doRes = await stub.fetch("http://localhost:8787/put");
console.log(await doRes.text()); // "1"

const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // "1"
```

## Using a Class Exported by Another Script

Miniflare supports the `script_name` option for accessing Durable Objects
exported by other scripts. This requires mounting the other worker as described
in [🔌 Multiple Workers](/core/multiple-workers). With the following setup:

```js
---
filename: api/src/worker.mjs
---
export class TestObject {
  fetch() {
    return new Response("API response");
  }
}
```

```toml
---
filename: api/wrangler.toml
---
name = "api"
[build.upload]
format = "modules"
dir = "src"
main = "./worker.mjs"
```

```js
---
filename: worker.mjs
---
export default {
  fetch(request, env, ctx) {
    const { TEST_OBJECT } = env.TEST_OBJECT;
    const id = TEST_OBJECT.newUniqueId();
    const stub = TEST_OBJECT.get(id);
    return stub.fetch(request);
  },
};
```

Miniflare can be configured to load `TestObject` from the `api` worker with:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[durable_objects]
bindings = [
  { name = "TEST_OBJECT", class_name = "TestObject", script_name = "api" },
]
```

```js
const mf = new Miniflare({
  workers: [
    {
      name: "api",
      durableObjects: {
        // scriptName must be the same as in the connected worker
        TEST_OBJECT: { className: "TestObject", scriptName: "api" },
      },
      modules: true,
      scriptPath: "api/src/worker.mjs",
    },
  ],
});
```

</ConfigTabs>

Workers can access Durable Objects declared in the `workers` field assuming it
has a `name` set.

## Internal Details

Durable Object instances are only unique within the same `Miniflare` instance.
Therefore, you may end up with more than one instance for the same ID (breaking
a core guarantee of Durable Objects) with multiple `Miniflare` instances running
the same code.

Transactions are implemented using **Optimistic Concurrency Control (OCC)** as
described in
["On optimistic methods for concurrency control." ACM Transactions on Database Systems](https://dl.acm.org/doi/10.1145/319566.319567).
This assumes most concurrent transactions will operate on disjoint key sets. For
development, it's likely there will be very little concurrency so this shouldn't
be a problem. If running tests in parallel, on the same `Miniflare` instance,
you may experience starvation in extreme cases. If you do, please
[open a GitHub issue](https://github.com/cloudflare/miniflare/issues/new/choose).
It would be interesting to hear about your use case.
