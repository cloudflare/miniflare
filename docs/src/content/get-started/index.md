---
order: 1
---

# Get Started

The Miniflare API allows you to dispatch events to workers without making actual HTTP requests, simulate connections between Workers, and interact with local emulations of storage products like [KV](/storage/kv), [R2](/storage/r2), and [Durable Objects](/storage/durable-objects). This makes it great for writing tests, or other advanced use cases where you need finer-grained control.

## Installation

Miniflare is installed using `npm` as a dev dependency:

```sh
$ npm install -D miniflare
```

## Usage

In all future examples, we'll assume Node.js is running in ES module mode. You
can do this by setting the `type` field in your `package.json`:

```json
---
filename: package.json
---
{
  "type": "module"
}
```

To initialise Miniflare, import the `Miniflare` class from `miniflare`:

```js
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request, env, ctx) {
      return new Response("Hello Miniflare!");
    }
  }
  `,
});

const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
await mf.dispose();
```

The [rest of these docs](/core/fetch) go into more detail on configuring
specific features.

<Aside type="warning" header="Warning">

The API won't automatically load configuration from `.env`,
`package.json` and `wrangler.toml` files in the current working directory. You
can enable this by setting the `envPath`
option to `true`:

```js
const mf = new Miniflare({
  envPath: true
});
```

Note that options specified in the constructor have higher priority than those
in `wrangler.toml`.

</Aside>

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

Miniflare's API is primarily intended for testing use cases, where file watching isn't usually required.  If you need to watch files, consider using a separate file watcher like [fs.watch()](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) or [chokidar](https://github.com/paulmillr/chokidar), and calling setOptions() with your original configuration on change.

To cleanup and stop listening for requests, you should `dispose()` your instances:

```js
await mf.dispose();
```

You can also manually reload scripts (main and Durable Objects') and options
(`.env`, `package.json` and `wrangler.toml`) by calling `setOptions()` with the original configuration object.
`.

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

### Dispatching Events

`getWorker` dispatches `fetch`, `queues`, and `scheduled` events
to workers respectively:

```js
---
highlight: [15,16,17,21]
---
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  script: `
  export default {
    let lastScheduledController;
    let lastQueueBatch;
    async fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (pathname === "/scheduled") {
        return Response.json({
          scheduledTime: lastScheduledController?.scheduledTime,
          cron: lastScheduledController?.cron,
        });
      } else if (pathname === "/queue") {
        return Response.json({
          queue: lastQueueBatch.queue,
          messages: lastQueueBatch.messages.map((message) => ({
            id: message.id,
            timestamp: message.timestamp.getTime(),
            body: message.body,
            bodyType: message.body.constructor.name,
          })),
        });
      } else if (pathname === "/get-url") {
        return new Response(request.url);
      } else {
        return new Response(null, { status: 404 });
      }
    },
    async scheduled(controller, env, ctx) {
      lastScheduledController = controller;
      if (controller.cron === "* * * * *") controller.noRetry();
    },
    async queue(batch, env, ctx) {
      lastQueueBatch = batch;
      if (batch.queue === "needy") batch.retryAll();
      for (const message of batch.messages) {
        if (message.id === "perfect") message.ack();
      }
    }
  }
  `,
});

const res = await mf.dispatchFetch("http://localhost:8787/", {
  headers: { "X-Message": "Hello Miniflare!" },
});
console.log(await res.text()); // Hello Miniflare!

const scheduledResult = await worker.scheduled({
  cron: "* * * * *",
});
console.log(scheduledResult); // { outcome: "ok", noRetry: true });

const queueResult = await worker.queue("needy", [
    { id: "a", timestamp: new Date(1000), body: "a" },
    { id: "b", timestamp: new Date(2000), body: { b: 1 } },
  ]);
console.log(queueResult) // { outcome: "ok", retryAll: true, ackAll: false, explicitRetries: [], explicitAcks: []}
```

See [📨 Fetch Events](/core/fetch) and [⏰ Scheduled Events](/core/scheduled)
for more details.

### HTTP Server

To start an HTTP server, use the `startServer` method. This
returns a
[Node.js `http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
instance:

```js
---
highlight: [11]
---
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `
  export default {
    async fetch(request, env, ctx) {
      return new Response("Hello Miniflare!");
    })
  }
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
Cloudflare endpoint. You can disable this behaviour, using the `cf` option:

```js
const mf = new Miniflare({
  cf: false,
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
  httpsCertPath: "./cert.pem"
});
```

To load an existing certificate from strings instead:

```js
const mf = new Miniflare({
  // These are all optional, you don't need to include them all
  httpsKey: "-----BEGIN RSA PRIVATE KEY-----...",
  httpsCert: "-----BEGIN CERTIFICATE-----...",
});
```

If both a string and path are specified for an option (e.g. `httpsKey` and
`httpsKeyPath`), the string will be preferred.

### Logging

By default, `[mf:*]` logs are disabled when using the API. To
enable these, set the `log` property to an instance of the `Log` class. Its only
parameter is a log level indicating which messages should be logged:

```js
---
highlight: [5]
---
import { Miniflare, Log, LogLevel } from "miniflare";

const mf = new Miniflare({
  scriptPath: "worker.js",
  log: new Log(LogLevel.DEBUG), // Enable debug messages
});
```

## Reference

```js
import { Miniflare, Log, LogLevel } from "miniflare";

const mf = new Miniflare({
  // All options are optional, but one of script or scriptPath is required

  log: new Log(LogLevel.INFO), // Logger Miniflare uses for debugging

  script: `
    export default {
      async fetch(request, env, ctx) {
        return new Response("Hello Miniflare!");
      }
    }
  `,
  scriptPath: "./index.js",

  modules: true, // Enable modules
  modulesRules: [
    // Modules import rule
    { type: "ESModule", include: ["**/*.js"], fallthrough: true },
    { type: "Text", include: ["**/*.text"] },
  ],
  compatibilityDate: "2021-11-23", // Opt into backwards-incompatible changes from
  compatibilityFlags: ["formdata_parser_supports_files"], // Control specific backwards-incompatible changes
  upstream: "https://miniflare.dev", // URL of upstream origin
  workers: [{
    // reference additional named workers
    name: "worker2",
    kvNamespaces: { COUNTS: "counts" },
    serviceBindings: {
      INCREMENTER: "incrementer",
      // Service bindings can also be defined as custom functions, with access
      // to anything defined outside Miniflare.
      async CUSTOM(request) {
        // `request` is the incoming `Request` object.
        return new Response(message);
      },
    },
    modules: true,
    script: `export default {
        async fetch(request, env, ctx) {
          // Get the message defined outside
          const response = await env.CUSTOM.fetch("http://host/");
          const message = await response.text();

          // Increment the count 3 times
          await env.INCREMENTER.fetch("http://host/");
          await env.INCREMENTER.fetch("http://host/");
          await env.INCREMENTER.fetch("http://host/");
          const count = await env.COUNTS.get("count");

          return new Response(message + count);
        }
      }`,
    },
  }],
  name: "worker", // Name of service
  routes: ["*site.mf/worker"],


  host: "127.0.0.1", // Host for HTTP(S) server to listen on
  port: 8787, // Port for HTTP(S) server to listen on
  https: true, // Enable self-signed HTTPS (with optional cert path)
  httpsKey: "-----BEGIN RSA PRIVATE KEY-----...",
  httpsKeyPath: "./key.pem", // Path to PEM SSL key
  httpsCert: "-----BEGIN CERTIFICATE-----...",
  httpsCertPath: "./cert.pem", // Path to PEM SSL cert chain
  cf: "./node_modules/.mf/cf.json", // Path for cached Request cf object from Cloudflare
  liveReload: true, // Reload HTML pages whenever worker is reloaded



  kvNamespaces: ["TEST_NAMESPACE"], // KV namespace to bind
  kvPersist: "./kv-data", // Persist KV data (to optional path)

  r2Buckets: ["BUCKET"], // R2 bucket to bind
  r2Persist: "./r2-data", // Persist R2 data (to optional path)

  durableObjects: {
    // Durable Object to bind
    TEST_OBJECT: "TestObject", // className
    API_OBJECT: { className: "ApiObject", scriptName: "api" },
  },
  durableObjectsPersist: "./durable-objects-data", // Persist Durable Object data (to optional path)

  cache: false, // Enable default/named caches (enabled by default)
  cachePersist: "./cache-data", // Persist cached data (to optional path)
  cacheWarnUsage: true, // Warn on cache usage, for workers.dev subdomains

  sitePath: "./site", // Path to serve Workers Site files from
  siteInclude: ["**/*.html", "**/*.css", "**/*.js"], // Glob pattern of site files to serve
  siteExclude: ["node_modules"], // Glob pattern of site files not to serve


  bindings: { SECRET: "sssh" }, // Binds variable/secret to environment
  wasmBindings: { ADD_MODULE: "./add.wasm" }, // WASM module to bind
  textBlobBindings: { TEXT: "./text.txt" }, // Text blob to bind
  dataBlobBindings: { DATA: "./data.bin" }, // Data blob to bind
});

await mf.setOptions({ kvNamespaces: ["TEST_NAMESPACE2"] }); // Apply options and reload

const bindings = await mf.getBindings(); // Get bindings (KV/Durable Object namespaces, variables, etc)

// Dispatch "fetch" event to worker
const res = await mf.dispatchFetch("http://localhost:8787/", {
  headers: { Authorization: "Bearer ..." },
});
const text = await res.text();

// Dispatch "scheduled" event to worker
const scheduledResult = await worker.scheduled({ cron: "30 * * * *" })

const TEST_NAMESPACE = await mf.getKVNamespace("TEST_NAMESPACE");

const BUCKET = await mf.getR2Bucket("BUCKET");

const caches = await mf.getCaches(); // Get global `CacheStorage` instance
const defaultCache = caches.default;
const namedCache = await caches.open("name");

// Get Durable Object namespace and storage for ID
const TEST_OBJECT = await mf.getDurableObjectNamespace("TEST_OBJECT");
const id = TEST_OBJECT.newUniqueId();
const storage = await mf.getDurableObjectStorage(id);

// Get Queue Producer
const producer = await mf.getQueueProducer("QUEUE_BINDING");

// Get D1 Database
const db = await mf.getD1Database("D1_BINDING")

await mf.dispose(); // Cleanup storage database connections and watcher
```
