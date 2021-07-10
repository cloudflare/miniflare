# 📌 Durable Objects

- [Durable Objects Reference](https://developers.cloudflare.com/workers/runtime-apis/durable-objects)
- [Using Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects)

## Objects

Specify Durable Objects to add to your environment as follows:

```shell
# Note Object1 and Object2 classes must be exported from the main script
$ miniflare --do OBJECT1=Object1 --do OBJECT2=Object2 # or -o
```

```toml
# wrangler.toml
[durable_objects]
bindings = [
  # Object1 class must be exported from the main script
  { name = "OBJECT1", class_name = "Object1" },
  # Object2 class must be exported from ./object2.mjs
  { name = "OBJECT2", class_name = "Object2", script_path = "./object2.mjs" },
]
```

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
    // Object2 class must be exported from ./object2.mjs
    OBJECT2: { className: "Object2", scriptPath: "./object2.mjs" },
  },
});
```

<!--prettier-ignore-start-->
::: tip
The `modules` option is automatically enabled when specifying Durable Object
bindings. See [📚 Modules](/modules.html) for more details.
:::
<!--prettier-ignore-end-->

## Persistence

By default, Durable Object data is stored in memory. It will persist between
reloads, but not CLI invocations or different `Miniflare` instances. To enable
persistence to the file system or Redis, specify the Durable Object persistence
option:

```shell
$ miniflare --do-persist # Defaults to ./mf/do
$ miniflare --do-persist ./data/  # Custom path
$ miniflare --do-persist redis://localhost:6379  # Redis server
```

```toml
# wrangler.toml
[miniflare]
durable_objects_persist = true # Defaults to ./mf/do
durable_objects_persist = "./data/" # Custom path
durable_objects_persist = "redis://localhost:6379" # Redis server
```

```js
const mf = new Miniflare({
  durableObjectsPersist: true, // Defaults to ./mf/do
  durableObjectsPersist: "./data", // Custom path
  durableObjectsPersist: "redis://localhost:6379", // Redis server
});
```

When using the file system, each object instance will get its own directory
within the Durable Object persistence directory.

When using Redis, each key will be prefixed with the object name and instance.
If you're using this with the API, make sure you call `dispose` on your
`Miniflare` instance to close database connections.

## Manipulating Outside Workers

For testing, it can be useful to put/get data from Durable Object storage
outside a worker. You can do this with the `getDurableObjectNamespace` method.
Durable Object stubs expose a non-standard `storage()` method to access the
instance's transactional storage:

```js{30-37}
import { Miniflare, Response } from "miniflare";

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
      if(url.pathname === "/put") await this.storage.put("key", 1);
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
let res = await mf.dispatchFetch("http://localhost:8787/put");
console.log(await res.text()); // 1

const ns = await mf.getDurableObjectNamespace("TEST_OBJECT");
const stub = ns.get(ns.idFromName("test"));
const doRes = await stub.fetch("http://localhost:8787/put");
console.log(await doRes.text()); // 1

const storage = await stub.storage(); // Non-standard method
t.is(await storage.get("key"), 1);
await storage.put("key", 2);

res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // 2;
```

## Internal Details

### Transactions

Transactional semantics only hold within the same Miniflare instance. Therefore,
you may end up with invalid transaction executions if you have Durable Object
persistence enabled on the same directory for many `Miniflare` instances. When
the instance is reloaded (e.g. changing script or options), all in-progress
transactions are silently aborted and won't commit.

Transactions are implemented using **Optimistic Concurrency Control (OCC)** as
described in
["On optimistic methods for concurrency control." ACM Transactions on Database Systems](https://dl.acm.org/doi/10.1145/319566.319567).
This assumes most concurrent transactions will operate on disjoint key sets. For
development, it's likely there will be very little concurrency so this shouldn't
be a problem. If running tests in parallel, on the same `Miniflare` instance,
you may experience starvation in extreme cases. If you do, please
[open a GitHub issue](https://github.com/mrbbot/miniflare/issues/new/choose). It
would be interesting to hear about your use case.

`deleteAll` also has slightly different semantics to Cloudflare's
implementation. Instead of preventing all operations until the `deleteAll`
completes, Miniflare will delete all keys that were present at the time
`deleteAll` was called.

### IDs

Durable Object IDs are 32 bytes long. Unique IDs are generated as follows:

```
 0 | 12345678 | 901234567890123456789012
---|----------|--------------------------
 0 | Time     | Randomness
```

Named IDs are generated by taking `SHA256(Object Name + Name)` then forcing the
first bit to be `1`. This ensures the same name always generates the same ID,
and named IDs are disjoint to unique IDs, since named IDs' first byte can never
be `0`.
