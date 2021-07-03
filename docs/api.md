# 🧰 Using the API

The API gives you finer-grained control over the CLI, allowing you to dispatch
events to workers without making actual HTTP requests. This makes it great for
writing tests, or advanced use cases.

## Installation

Miniflare is installed using `npm`:

```shell
$ npm install -D miniflare
```

## Usage

In all future examples, we'll assume NodeJS is running in ES module mode. You
can do this by setting the `type` field in your `package.json`:

```json
{
  "type": "module"
}
```

To initialise Miniflare, import the `Miniflare` class from `miniflare`:

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response("Hello Miniflare!"));
  });
  `,
});
const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
```

The [Guide](/fetch.html) goes into more detail on configuring specific features.

<!--prettier-ignore-start-->
::: warning
Like the CLI, the API will automatically load `.env` and `wrangler.toml` files
in the current working directory. This may lead to unexpected results. You can
disable this by setting `envPath` and `wranglerConfigPath` options to paths of
empty files:

```js
const mf = new Miniflare({
  envPath: ".env.empty",
  wranglerConfigPath: "wrangler.empty.toml"
});
```
:::
<!--prettier-ignore-end-->

Note that options specified in the constructor have higher priority than those
in `wrangler.toml`.

### String and File Scripts

Note in the above example we're specifying `script` as a string. We could've
equally put the script in a file such as `worker.js`, then used the `scriptPath`
property instead:

```js
const mf = new Miniflare({
  scriptPath: "worker.js",
});
```

### Watching and Reloading

You can watch scripts, `.env` files and `wrangler.toml` files with the `watch`
option. When this is enabled, you must `dispose` of the watcher when you're done
with the `Miniflare` instance:

```js
const mf = new Miniflare({
  watch: true,
});
...
await mf.dispose();
```

You can also manually reload scripts (main and Durable Object's) and options
(`.env` and `wrangler.toml`) too with `reloadScript` and `reloadOptions`.
Reloading scripts implicitly reloads options too:

```js
const mf = new Miniflare({ ... });
await mf.reloadScript();
await mf.reloadOptions();
```

### Getting Processed Options

You can get an object containing processed options with `getOptions`. These
contain options resolved from the constructor, `.env` files and `wrangler.toml`
files.

```js
const mf = new Miniflare({ ... });
const options = await mf.getOptions();
```

### Dispatching Events

`dispatchFetch` and `dispatchScheduled` dispatch `fetch` and `scheduled` events
to workers respectively:

```js{15-17,21}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.waitUntil(Promise.resolve(event.request.url));
    event.respondWith(new Response(event.request.headers.get("X-Message")));
  });
  addEventListener("scheduled", (event) => {
    event.waitUntil(Promise.resolve(event.scheduledTime));
  });
  `,
});

const res = await mf.dispatchFetch("http://localhost:8787/", {
  headers: { "X-Message": "Hello Miniflare!" },
});
console.log(await res.text()); // Hello Miniflare!
console.log((await res.waitUntil())[0]); // http://localhost:8787/

const waitUntil = await mf.dispatchScheduled(1000);
console.log(waitUntil[0]); // 1000
```

See [📨 Fetch Events](/fetch.html) and [⏰ Scheduled Events](/scheduled.html)
for more details.

### HTTP Server

To start an HTTP server like the CLI's, use the `createServer` method. This
returns a
[NodeJS `http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
instance:

```js{10}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response("Hello Miniflare!"));
  });
  `,
});
mf.createServer().listen(5000, () => {
  console.log("Listening on :5000");
});
```

Note that `port` and `host` options are ignored by default. It's up to you to
get and use them:

```js
const options = await mf.getOptions();
const port = options.port ?? 5000; // Use port 5000 by default
mf.createServer().listen(port, () => { ... });
```

### Logging

By default, `[mf:*]` logs as seen in the CLI are disabled when using the API. To
enable these, set the `log` property to an instance of the `ConsoleLog` class.
Its only parameter is a boolean indicating whether debug messages should be
logged:

```js{5}
import { Miniflare, ConsoleLog } from "miniflare";

const mf = new Miniflare({
  scriptPath: "worker.js",
  log: new ConsoleLog(true), // Enable --debug messages
});
```

### Arbitrary Bindings

The `bindings` property can be used to inject arbitrary objects into the global
scope of the sandbox. This can be very useful for testing:

```js{9-11}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response(greet("Miniflare")));
  });
  `,
  bindings: {
    greet: (name) => `Hello ${name}!`,
  },
});
const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
```
