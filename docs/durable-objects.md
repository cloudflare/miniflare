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
  },
});
```

## Persistence

By default, Durable Object data is stored in memory. It will persist between
reloads, but not CLI invocations or different `Miniflare` instances. To enable
persistence to the file system or Redis, specify the Durable Object persistence
option:

```shell
$ miniflare --do-persist # Defaults to ./.mf/do
$ miniflare --do-persist ./data/  # Custom path
$ miniflare --do-persist redis://localhost:6379  # Redis server
```

```toml
# wrangler.toml
[miniflare]
durable_objects_persist = true # Defaults to ./.mf/do
durable_objects_persist = "./data/" # Custom path
durable_objects_persist = "redis://localhost:6379" # Redis server
```

```js
const mf = new Miniflare({
  durableObjectsPersist: true, // Defaults to ./.mf/do
  durableObjectsPersist: "./data", // Custom path
  durableObjectsPersist: "redis://localhost:6379", // Redis server
});
```

When using the file system, each object instance will get its own directory
within the Durable Object persistence directory.

When using Redis, each key will be prefixed with the object name and instance.
If you're using this with the API, make sure you call `dispose` on your
`Miniflare` instance to close database connections.

<!--prettier-ignore-start-->
::: warning
Redis support is not included by default. You must install an optional peer dependency:
```
$ npm install -D @miniflare/storage-redis
```
:::
<!--prettier-ignore-end-->

## Validation

Like the real Workers runtime, Miniflare will throw errors when:

- The string passed to `DurableObjectNamespace#idFromString(hexId)` is not 64
  hex digits
- The hex-ID passed to `DurableObjectNamespace#idFromString(hexId)` is for a
  different Durable Object
- The ID passed to `DurableObjectNamespace#get(id)` is for a different Durable
  Object
- Keys are greater than `2KiB` or `undefined`
- Values are greater than `32KiB`
- Attempting to `get`, `put` or `delete` more than `128` keys
- Attempting to modify more than `128` keys in a transaction
- Attempting to `put` an `undefined` value
- Attempting to list keys with a negative `limit`
- Attempting to perform an operation in a rolledback transaction or in a
  transaction that has already committed
- Attempting to call `deleteAll()` in a transaction

## Manipulating Outside Workers

For testing, it can be useful to put/get data from Durable Object storage
outside a worker. You can do this with the `getDurableObjectNamespace` and
`getDurableObjectStorage` methods.

```js{30-38}
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
console.log(await res.text()); // "1"

const ns = await mf.getDurableObjectNamespace("TEST_OBJECT");
const id = ns.idFromName("test");
const stub = ns.get(id);
const doRes = await stub.fetch("http://localhost:8787/put");
console.log(await doRes.text()); // "1"

const storage = await mf.getDurableObjectStorage(id);
console.log(await storage.get("key")); // 1
await storage.put("key", 2);

res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // "2"
```

## Using a Class Exported by Another Script

Miniflare supports the `script_name` option for accessing Durable Objects
exported by other scripts. This requires mounting the other worker as described
in [🔌 Multiple Workers](/mount.html). With the following setup:

```js
// api/src/worker.mjs
export class TestObject {
  fetch() {
    return new Response("API response");
  }
}
```

```toml
# api/wrangler.toml
name = "api"
[build.upload]
format = "modules"
dir = "src"
main = "./worker.mjs"
```

```js
// worker.mjs
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

```toml
# wrangler.toml
[durable_objects]
bindings = [
  # script_name must be the same as in [miniflare.mounts]
  { name = "TEST_OBJECT", class_name = "TestObject", script_name = "api" },
]
[miniflare.mounts]
api = "./api"
```

```js
const mf = new Miniflare({
  durableObjects: {
    // scriptName must be the same as in mounts
    TEST_OBJECT: { className: "TestObject", scriptName: "api" },
  },
  mounts: { api: "./api" },
});
```

Note it's not possible to set `script_name` via the CLI.

## Internal Details

Transactional semantics only hold within the same Miniflare instance. Therefore,
you may end up with invalid transaction executions if you have Durable Object
persistence enabled on the same directory for many `Miniflare` instances.

Transactions are implemented using **Optimistic Concurrency Control (OCC)** as
described in
["On optimistic methods for concurrency control." ACM Transactions on Database Systems](https://dl.acm.org/doi/10.1145/319566.319567).
This assumes most concurrent transactions will operate on disjoint key sets. For
development, it's likely there will be very little concurrency so this shouldn't
be a problem. If running tests in parallel, on the same `Miniflare` instance,
you may experience starvation in extreme cases. If you do, please
[open a GitHub issue](https://github.com/cloudflare/miniflare/issues/new/choose).
It would be interesting to hear about your use case.
