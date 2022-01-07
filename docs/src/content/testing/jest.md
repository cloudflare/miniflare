---
order: 0
---

# 🤹 Jest Environment

Miniflare includes a custom Jest environment that allows you to run your unit
tests within the Miniflare sandbox. Note that Jest 27 is required. See
[this repository](https://github.com/mrbbot/miniflare-typescript-esbuild-jest)
for an example using TypeScript.

## Setup

The Miniflare environment isn't installed by default, install it and Jest with:

```sh
$ npm install -D jest-environment-miniflare jest
```

In the following examples, we'll assume your `package.json` contains
`"type": "module"`, and that you're using a tool to bundle your worker. See
[⚡️ Developing with esbuild](/developing/esbuild) for an example.

To enable the Miniflare environment, set the
[`testEnvironment` option](https://jestjs.io/docs/configuration#testenvironment-string)
in your Jest configuration:

```js
---
filename: jest.config.js
---
export default {
  testEnvironment: "miniflare",
  // Configuration is automatically loaded from `.env`, `package.json` and
  // `wrangler.toml` files by default, but you can pass any additional Miniflare
  // API options here:
  testEnvironmentOptions: {
    bindings: { KEY: "value" },
    kvNamespaces: ["TEST_NAMESPACE"],
  },
};
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
import { handleRequest } from "../src/index.js";

test("responds with url", async () => {
  const req = new Request("http://localhost/");
  const res = await handleRequest(req);
  expect(await res.text()).toBe("URL: http://localhost/ KEY: value");
});
```

Modules support is still experimental in Jest and requires the
`--experimental-vm-modules` flag. To run this test:

```sh
$ NODE_OPTIONS=--experimental-vm-modules npx jest
```

## Isolated Storage

The Miniflare environment will use isolated storage for KV namespaces, caches,
and Durable Objects in each test. This essentially means any changes you make in
a test or `describe`-block are automatically undone afterwards. The isolated
storage is copied from the parent `describe`-block, allowing you to seed data in
`beforeAll` hooks.

As an example, consider the following tests:

```js
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
`durableObjectsPersist`) are ignored by the Miniflare Jest environment.

## Durable Objects

When testing Durable Objects, Miniflare needs to run your script itself to
extract exported Durable Object classes. Miniflare should be able to auto-detect
your script from your `package.json` or `wrangler.toml` file, but you can also
set it manually in Jest configuration:

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

```js
---
filename: jest.config.js
---
export default {
  testEnvironment: "miniflare",
  testEnvironmentOptions: {
    modules: true,
    scriptPath: "./src/index.mjs",
    durableObjects: {
      TEST_OBJECT: "TestObject",
    },
  },
};
```

To access Durable Object storage in tests, use the
`getMiniflareDurableObjectStorage` global method:

```js
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
be run twice, as Miniflare and Jest don't share a module cache. This usually
won't be a problem, but be aware you may have issues with unique `Symbol()`s or
`instanceof`s.

</Aside>
