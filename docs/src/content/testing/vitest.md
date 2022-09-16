---
order: 1
---

# ⚡️ Vitest Environment

Miniflare includes a custom Vitest environment that allows you to run your unit
tests within the Miniflare sandbox. Note that Vitest 0.23.0 is required.

## Setup

The Miniflare environment isn't installed by default, install it and Vitest
with:

```sh
$ npm install -D vitest-environment-miniflare vitest
```

In the following examples, we'll assume your `package.json` contains
`"type": "module"`, and that you're using a tool to bundle your worker. See
[⚡️ Developing with esbuild](/developing/esbuild) for an example.

To enable the Miniflare environment, set the
[`environment` option](https://Vitestjs.io/docs/configuration#testenvironment-string)
in your Vitest configuration:

```ts
---
filename: vitest.config.ts
---
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "miniflare",
    // Configuration is automatically loaded from `.env`, `package.json` and
    // `wrangler.toml` files by default, but you can pass any additional Miniflare
    // API options here:
    environmentOptions: {
      bindings: { KEY: "value" },
      kvNamespaces: ["TEST_NAMESPACE"],
    },
  },
})
```

## Writing and Running Tests

The Miniflare environment lets us import our worker's functions with regular
`import` syntax. We can write a test for the following worker like so:

```js
---
filename: src/index.js
---
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

// Assuming you've got a build tool that removes `export`s when you actually
// deploy your worker (e.g. https://esbuild.github.io/api/#format-iife)
export async function handleRequest(request) {
  return new Response(`URL: ${request.url} KEY: ${KEY}`);
}
```

```js
---
filename: test/index.spec.js
---
import { expect, test } from "vitest";
import { handleRequest } from "../src/index.js";

test("responds with url", async () => {
  const req = new Request("http://localhost/");
  const res = await handleRequest(req);
  expect(await res.text()).toBe("URL: http://localhost/ KEY: value");
});
```

To run this test:

```sh
$ NODE_OPTIONS=--experimental-vm-modules npx vitest run
```

## Isolated Storage

The Miniflare environment will use isolated storage for KV namespaces, caches,
Durable Objects and D1 databases in each test. This essentially means any
changes you make in a test or `describe`-block are automatically undone
afterwards. The isolated storage is copied from the parent `describe`-block,
allowing you to seed data in `beforeAll` hooks.

<Aside type="warning" header="Warning">

Unlike the [🤹 Jest Environment](/testing/jest), you must call the global
`setupMiniflareIsolatedStorage()` method at the start of your tests and use the
returned `describe` function in-place of the regular `describe`/`suite`
functions imported from `vitest` to enable isolated storage.

We're investigating ways of removing this requirement in the future, and will
likely remove this function in a future release.

Note `concurrent` tests cannot be used with isolated storage.

</Aside>

As an example, consider the following tests:

```js
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

// Gets the array
async function get() {
  const jsonValue = await TEST_NAMESPACE.get("array");
  return JSON.parse(jsonValue ?? "[]");
}

// Pushes an item onto the end of the array
async function push(item) {
  const value = await get();
  value.push(item);
  await TEST_NAMESPACE.put("array", JSON.stringify(value));
}

beforeAll(async () => {
  await push("beforeAll");
});

beforeEach(async () => {
  // This runs in each tests' isolated storage environment
  await push("beforeEach");
});

test("test 1", async () => {
  // This push(1) will only mutate the isolated environment
  await push(1);
  expect(await get()).toEqual(["beforeAll", "beforeEach", 1]);
});

test("test 2", async () => {
  await push(2);
  // Note that push(1) from the previous test has been "undone"
  expect(await get()).toEqual(["beforeAll", "beforeEach", 2]);
});

describe("describe", () => {
  beforeAll(async () => {
    await push("describe: beforeAll");
  });

  beforeEach(async () => {
    await push("describe: beforeEach");
  });

  test("test 3", async () => {
    await push(3);
    expect(await get()).toEqual([
      // All beforeAll's run before beforeEach's
      "beforeAll",
      "describe: beforeAll",
      "beforeEach",
      "describe: beforeEach",
      3,
    ]);
  });

  test("test 4", async () => {
    await push(4);
    expect(await get()).toEqual([
      "beforeAll",
      "describe: beforeAll",
      "beforeEach",
      "describe: beforeEach",
      4,
    ]);
  });
});
```

Note that bindings (e.g. variables, KV namespaces, etc) are only included in the
global scope when you're using a `service-worker` format worker. In `modules`
mode, you can use the `getMiniflareBindings` global method:

```js
const { TEST_NAMESPACE } = getMiniflareBindings();
```

Note also that storage persistence options (`kvPersist`, `cachePersist`, and
`durableObjectsPersist`) are ignored by the Miniflare Vitest environment.

## Durable Objects

When testing Durable Objects, Miniflare needs to run your script itself to
extract exported Durable Object classes. Miniflare should be able to auto-detect
your script from your `package.json` or `wrangler.toml` file, but you can also
set it manually in Vitest configuration:

```js
---
filename: src/index.mjs
---
export class TestObject {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch() {
    const count = (await this.storage.get("count")) + 1;
    this.storage.put("count", count);
    return new Response(count.toString());
  }
}
```

```ts
---
filename: vitest.config.ts
---
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "miniflare",
    environmentOptions: {
      modules: true,
      scriptPath: "./src/index.mjs",
      durableObjects: {
        TEST_OBJECT: "TestObject",
      },
    },
  },
})
```

To access Durable Object storage in tests, use the
`getMiniflareDurableObjectStorage()` global function:

```js
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

test("increments count", async () => {
  // Durable Objects requires modules mode so bindings aren't accessible via the
  // global scope
  const { TEST_OBJECT } = getMiniflareBindings();
  const id = TEST_OBJECT.newUniqueId();

  // Seed Durable Object storage (isolated storage rules from above also apply)
  const storage = await getMiniflareDurableObjectStorage(id);
  await storage.put("count", 3);

  // Increment the count
  const stub = TEST_OBJECT.get(id);
  const res = await stub.fetch("http://localhost/");
  expect(await res.text()).toBe("4");

  // Check storage updated
  expect(await storage.get("count")).toBe(4);
});
```

<Aside type="warning" header="Warning">

Note that if you also import `../src/index.mjs` in your test, your script will
be run twice, as Miniflare and Vitest don't share a module cache. This usually
won't be a problem, but be aware you may have issues with unique `Symbol()`s or
`instanceof`s.

</Aside>

To immediately invoke _("flush")_ scheduled Durable Object alarms, use the
`flushMiniflareDurableObjectAlarms()` global function:

```js
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

test("flushes alarms", async () => {
  // Get Durable Object stub
  const env = getMiniflareBindings();
  const id = env.TEST_OBJECT.newUniqueId();
  const stub = env.TEST_OBJECT.get(id);

  // Schedule Durable Object alarm
  await stub.fetch("http://localhost/");

  // Flush all alarms...
  await flushMiniflareDurableObjectAlarms();
  // ...or specify an array of `DurableObjectId`s to flush
  await flushMiniflareDurableObjectAlarms([id]);
});
```

### Constructing Durable Objects Directly

Alternatively, you can construct instances of your Durable Object using
`DurableObjectState`s returned by the `getMiniflareDurableObjectState()` global
function. This allows you to call instance methods and access ephemeral state
directly. Wrapping calls to instance methods with
`runWithMiniflareDurableObjectGates()` will close the Durable Object's input
gate, and wait for the output gate to open before resolving. Make sure to use
this when calling your `fetch()` method.

```js
---
filename: test / index.spec.js
---
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

import { TestObject } from "../src/index.mjs";

test("increments count", async () => {
  const env = getMiniflareBindings();
  // Use standard Durable Object bindings to generate IDs
  const id = env.TEST_OBJECT.newUniqueId();

  // Get DurableObjectState, and seed Durable Object storage
  // (isolated storage rules from above also apply)
  const state = await getMiniflareDurableObjectState(id);
  await state.storage.put("count", 3);

  // Construct object directly
  const object = new TestObject(state, env);

  // Concurrently increment the count twice. Wrapping `object.fetch`
  // calls with `runWithMiniflareDurableObjectGates(state, ...)`
  // closes `object`'s input gate when fetching, preventing race
  // conditions.
  const [res1, res2] = await Promise.all([
    runWithMiniflareDurableObjectGates(state, () => {
      return object.fetch(new Request("http://localhost/"));
    }),
    runWithMiniflareDurableObjectGates(state, () => {
      return object.fetch(new Request("http://localhost/"));
    }),
  ]);
  expect(await res1.text()).toBe("4");
  expect(await res2.text()).toBe("5");

  // Check storage updated twice
  expect(await state.storage.get("count")).toBe(5);
});
```

## Mocking Outbound `fetch` Requests

Miniflare allows you to substitute custom `Response`s for `fetch()` calls using
`undici`'s
[`MockAgent` API](https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin).
This is useful for testing workers that make HTTP requests to other services. To
obtain a correctly set-up
[`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin),
use the `getMiniflareFetchMock()` global function.

```js
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

test("mocks fetch", async () => {
  // Get correctly set up `MockAgent`
  const fetchMock = getMiniflareFetchMock();

  // Throw when no matching mocked request is found
  // (see https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentdisablenetconnect)
  fetchMock.disableNetConnect();

  // Mock request to https://example.com/thing
  // (see https://undici.nodejs.org/#/docs/api/MockAgent?id=mockagentgetorigin)
  const origin = fetchMock.get("https://example.com");
  // (see https://undici.nodejs.org/#/docs/api/MockPool?id=mockpoolinterceptoptions)
  origin
    .intercept({ method: "GET", path: "/thing" })
    .reply(200, "Mocked response!");

  const res = await fetch("https://example.com/thing");
  const text = await res.text();
  expect(text).toBe("Mocked response!");
});
```

## Waiting for `waitUntil`ed `Promise`s

To `await` the results of `waitUntil`ed `Promise`s, call the
`getMiniflareWaitUntil()` global function on a `FetchEvent`, `ScheduledEvent` or
`ExecutionContext`. This will return a `Promise` that resolves to an array of
resolved `waitUntil`ed `Promise` values:

```js
---
filename: src/index.js
---
export default {
  async fetch(request, env, ctx) {
    ctx.waitUntil(Promise.resolve(1));
    ctx.waitUntil(Promise.resolve(2));
    ctx.waitUntil(Promise.resolve(3));
    return new Response("body");
  }
}
```

```js
---
filename: test/index.spec.js
---
import { expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

import worker from "../src/index.js";

test("wait until", async () => {
  const request = new Request("http://localhost:8787/");
  const env = getMiniflareBindings();
  const ctx = new ExecutionContext();

  // Call module worker handler
  const response = worker.fetch(request, env, ctx);
  expect(await response.text()).toBe("body");

  // Check resolved values of waitUntil'ed Promises
  const waitUntils = await getMiniflareWaitUntil(ctx);
  expect(waitUntils).toEqual([1, 2, 3]);
});
```
