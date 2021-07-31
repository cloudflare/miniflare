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
Like the CLI, the API will automatically load `.env`, `package.json` and `wrangler.toml` files
in the current working directory. This may lead to unexpected behaviour. You can
disable this by setting `envPath`, `packagePath` and `wranglerConfigPath` options to paths of
empty files:

```js
const mf = new Miniflare({
  envPath: ".env.empty",
  packagePath: "package.empty.json", // Containing empty object: {}
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
(`.env`, `package.json` and `wrangler.toml`) too with `reloadOptions`:

```js
const mf = new Miniflare({ ... });
await mf.reloadOptions();
```

### Getting Processed Options

You can get an object containing processed options with `getOptions`. These
contain options resolved from the constructor, `.env`, `package.json` and
`wrangler.toml` files:

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
[Node.js `http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
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

### HTTPS Server

To start an HTTPS server instead, set the `https` option as described below and
pass `true` as the secure argument of `createServer`. Note that you must now
`await` the call to `createServer`:

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  ...,
  https: ...
});
(await mf.createServer(true)).listen(5000, () => {
  console.log("Listening on :5000");
});
```

To use an automatically generated self-signed certificate, set `https` to
`true`. This certificate will be valid for 30 days and be cached in `./.mf/cert`
by default. You can customise this directory by setting `https` to a string path
instead. The certificate will be renewed if it expires in less than 2 days:

```js
const mf = new Miniflare({
  https: true, // Cache certificate in ./.mf/cert
  https: "./cert_cache", // Cache in ./cert_cache instead
});
```

To load an existing certificate from the file system:

```js
const mf = new Miniflare({
  https: {
    // These are all optional, you don't need to include them all
    keyPath: "./key.pem",
    certPath: "./cert.pem",
    caPath: "./ca.pem",
    pfxPath: "./pfx.pfx",
    passphrase: "pfx passphrase",
  },
});
```

To load an existing certificate from strings instead:

```js
const mf = new Miniflare({
  https: {
    // These are all optional, you don't need to include them all
    key: "-----BEGIN RSA PRIVATE KEY-----...",
    cert: "-----BEGIN CERTIFICATE-----...",
    ca: "...",
    pfx: "...",
    passphrase: "pfx passphrase",
  },
});
```

If both a string and path are specified for an option (e.g. `key` and
`keyPath`), the string will be preferred.

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
