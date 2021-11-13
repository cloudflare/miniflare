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

In all future examples, we'll assume Node.js is running in ES module mode. You
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
Unlike the CLI, the API won't automatically load configuration from `.env`,
`package.json` and `wrangler.toml` files in the current working directory. You
can enable this by setting the `envPath`, `packagePath` and `wranglerConfigPath`
options to `true`:

```js
const mf = new Miniflare({
  envPath: true,
  packagePath: true,
  wranglerConfigPath: true,
});
```

Note that options specified in the constructor have higher priority than those
in `wrangler.toml`.
:::
<!--prettier-ignore-end-->

### String and File Scripts

Note in the above example we're specifying `script` as a string. We could've
equally put the script in a file such as `worker.js`, then used the `scriptPath`
property instead:

```js
const mf = new Miniflare({
  scriptPath: "worker.js",
});
```

### Watching, Reloading and Disposing

You can watch scripts, `.env`, `package.json` and `wrangler.toml` files with the
`watch` option. When this is enabled, you must `dispose` of the watcher when
you're done with the `Miniflare` instance:

```js
const mf = new Miniflare({
  watch: true,
});
...
await mf.dispose();
```

You must also `dispose` if you're persisting KV, cache, or Durable Object data
in Redis to close opened connections.

You can also manually reload scripts (main and Durable Objects') and options
(`.env`, `package.json` and `wrangler.toml`) with `reload`:

```js
const mf = new Miniflare({ ... });
await mf.reload();
```

Miniflare will emit a `reload` event whenever it reloads too:

```js
const mf = new Miniflare({ ... });
mf.addEventListener("reload", (event) => {
  console.log("Worker reloaded!");
});
```

### Updating Options and the Global Scope

You can use the `setOptions` method to update the options of an existing
`Miniflare` instance. This accepts the same options object as the
`new Miniflare` constructor, applies those options, then reloads the worker.

```js
const mf = new Miniflare({
  script: "...",
  kvNamespaces: ["TEST_NAMESPACE"],
  bindings: { KEY: "value1" },
});

// Only updates `bindings`, leaves `script` and `kvNamespaces` alone
await mf.setOptions({
  bindings: { KEY: "value2" },
});
```

You can also access the global scope of the sandbox directly using the
`getGlobalScope` method. Ideally, use should use the `setOptions` method when
updating the environment dynamically, as Miniflare creates a new global scope
each reload, so your changes will be lost:

```js
const mf = new Miniflare({
  globals: { KEY: "value1" },
});
const globalScope = await mf.getGlobalScope();
globalScope.KEY = "value2";
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

To start an HTTP server like the CLI's, use the `startServer` method. This
returns a
[Node.js `http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
instance:

```js{11}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response("Hello Miniflare!"));
  });
  `,
  port: 5000,
});
const server = await mf.startServer();
console.log("Listening on :5000");
```

You can also just create the server with `createServer` and start it yourself.
Note that you're then responsible for setting the correct host and port:

```js
const mf = new Miniflare({
  script: "...",
  port: 5000,
});
const server = await mf.createServer();
const { HTTPPlugin } = await mf.getPlugins();
server.listen(HTTPPlugin.port, () => {
  console.log(`Listening on :${HTTPPlugin.port}`);
});
```

#### `Request#cf` Object

By default, Miniflare will fetch the `Request#cf` object from a trusted
Cloudflare endpoint. You can disable this behaviour, using the `cfFetch` option:

```js
const mf = new Miniflare({
  cfFetch: false,
});
```

You can also provide a custom request metadata provider, which takes the
incoming Node request and may look-up information in a geo-IP database:

```js
const mf = new Miniflare({
  async metaProvider(req) {
    return {
      forwardedProto: req.headers["X-Forwarded-Proto"],
      realIp: req.headers["X-Forwarded-For"],
      cf: {
        // Could get these from a geo-IP database
        colo: "SFO",
        country: "US",
        // ...
      },
    };
  },
});
```

### HTTPS Server

To start an HTTPS server instead, set the `https` option. To use an
automatically generated self-signed certificate, set `https` to `true`. This
certificate will be valid for 30 days and be cached in `./.mf/cert` by default.
You can customise this directory by setting `https` to a string path instead.
The certificate will be renewed if it expires in less than 2 days:

```js
const mf = new Miniflare({
  https: true, // Cache certificate in ./.mf/cert
  https: "./cert_cache", // Cache in ./cert_cache instead
});
```

To load an existing certificate from the file system:

```js
const mf = new Miniflare({
  // These are all optional, you don't need to include them all
  httpsKeyPath: "./key.pem",
  httpsCertPath: "./cert.pem",
  httpsCaPath: "./ca.pem",
  httpsPfxPath: "./pfx.pfx",
  httpsPassphrase: "pfx passphrase",
});
```

To load an existing certificate from strings instead:

```js
const mf = new Miniflare({
  // These are all optional, you don't need to include them all
  httpsKey: "-----BEGIN RSA PRIVATE KEY-----...",
  httpsCert: "-----BEGIN CERTIFICATE-----...",
  httpsCa: "...",
  httpsPfx: "...",
  httpsPassphrase: "pfx passphrase",
});
```

If both a string and path are specified for an option (e.g. `httpsKey` and
`httpsKeyPath`), the string will be preferred.

### CRON Scheduler

To start a CRON scheduler like the CLI's, use the `startScheduler` method. This
will dispatch `scheduled` events according to the specified CRON expressions:

```js
const mf = new Miniflare({
  crons: ["30 * * * *"],
});
const scheduler = await mf.startScheduler();
// ...
// Stop dispatching events
await scheduler.dispose();
```

### Logging

By default, `[mf:*]` logs as seen in the CLI are disabled when using the API. To
enable these, set the `log` property to an instance of the `Log` class. Its only
parameter is a log level indicating which messages should be logged:

```js{5}
import { Miniflare, Log, LogLevel } from "miniflare";

const mf = new Miniflare({
  scriptPath: "worker.js",
  log: new Log(LogLevel.DEBUG), // Enable --debug messages
});
```

### Arbitrary Globals

The `globals` property can be used to inject arbitrary objects into the global
scope of the sandbox. This can be very useful for testing:

```js{9-11}
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response(greet("Miniflare")));
  });
  `,
  globals: {
    greet: (name) => `Hello ${name}!`,
  },
});
const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
```
