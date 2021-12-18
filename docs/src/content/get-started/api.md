---
order: 1
---

# 🧰 Using the API

The API gives you finer-grained control over the CLI, allowing you to dispatch
events to workers without making actual HTTP requests. This makes it great for
writing tests, or advanced use cases.

## Installation

Miniflare is installed using `npm`:

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
  script: `
  addEventListener("fetch", (event) => {
    event.respondWith(new Response("Hello Miniflare!"));
  });
  `,
});
const res = await mf.dispatchFetch("http://localhost:8787/");
console.log(await res.text()); // Hello Miniflare!
```

The [rest of these docs](/core/fetch) go into more detail on configuring
specific features.

<Aside type="warning" header="Warning">

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

You can watch scripts, `.env`, `package.json` and `wrangler.toml` files with the
`watch` option. When this is enabled, you must `dispose` of the watcher when
you're done with the `Miniflare` instance:

```js
const mf = new Miniflare({
  watch: true,
});
// ...
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

```js
---
highlight: [15,16,17,21]
---
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

See [📨 Fetch Events](/core/fetch) and [⏰ Scheduled Events](/core/scheduled)
for more details.

### HTTP Server

To start an HTTP server like the CLI's, use the `startServer` method. This
returns a
[Node.js `http.Server`](https://nodejs.org/api/http.html#http_class_http_server)
instance:

```js
---
highlight: [11]
---
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

```js
---
highlight: [5]
---
import { Miniflare, Log, LogLevel } from "miniflare";

const mf = new Miniflare({
  scriptPath: "worker.js",
  log: new Log(LogLevel.DEBUG), // Enable --debug messages
});
```

### Arbitrary Globals

The `globals` property can be used to inject arbitrary objects into the global
scope of the sandbox. This can be very useful for testing:

```js
---
highlight: [9,10,11]
---
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

## Reference

```js
import { Miniflare, Log, LogLevel } from "miniflare";

const mf = new Miniflare({
  // All options are optional, but one of script or scriptPath is required

  log: new Log(LogLevel.INFO), // Logger Miniflare uses for debugging
  sourceMap: true, // Enable source map support globally

  script: `export default {
    async fetch(request, env, ctx) {
      return new Response("Hello Miniflare!");
    }
  }`,
  scriptPath: "./index.mjs",

  wranglerConfigPath: true, // Load configuration from wrangler.toml
  wranglerConfigPath: "./wrangler.custom.toml", // ...or custom wrangler.toml path

  wranglerConfigEnv: "dev", // Environment in wrangler.toml to use

  packagePath: true, // Load script from package.json
  packagePath: "./package.custom.json", // ...or custom package.json path

  modules: true, // Enable modules
  modulesRules: [
    // Modules import rule
    { type: "ESModule", include: ["**/*.js"], fallthrough: true },
    { type: "Text", include: ["**/*.text"] },
  ],
  compatibilityDate: "2021-11-23", // Opt into backwards-incompatible changes from
  compatibilityFlags: ["formdata_parser_supports_files"], // Control specific backwards-incompatible changes
  upstream: "https://miniflare.dev", // URL of upstream origin
  watch: true, // Watch files for changes
  mounts: {
    // Mount additional named workers
    api: "./api",
    site: {
      rootPath: "./site", // Path to resolve files relative to
      scriptPath: "./index.js", // Resolved as ./site/index.js
      sitePath: "./public", // Resolved as ./site/public
      routes: ["site.mf/*"], // Route requests matching site.mf/* to this worker
    },
  },

  host: "127.0.0.1", // Host for HTTP(S) server to listen on
  port: 8787, // Port for HTTP(S) server to listen on
  https: true, // Enable self-signed HTTPS (with optional cert path)
  httpsKey: "-----BEGIN RSA PRIVATE KEY-----...",
  httpsKeyPath: "./key.pem", // Path to PEM SSL key
  httpsCert: "-----BEGIN CERTIFICATE-----...",
  httpsCertPath: "./cert.pem", // Path to PEM SSL cert chain
  httpsCa: "...",
  httpsCaPath: "./ca.pem", // Path to SSL trusted CA certs
  httpsPfx: "...",
  httpsPfxPath: "./pfx.pfx", // Path to PFX/PKCS12 SSL key/cert chain
  httpsPassphrase: "pfx passphrase", // Passphrase to decrypt SSL files
  cfFetch: "./node_modules/.mf/cf.json", // Path for cached Request cf object from Cloudflare
  async metaProvider(req) {
    // Custom request metadata provider taking Node `http.IncomingMessage`
    return {
      forwardedProto: req.headers["X-Forwarded-Proto"],
      realIp: req.headers["X-Forwarded-For"],
      cf: {
        colo: "SFO",
        country: "US",
        // ...
      },
    };
  },
  liveReload: true, // Reload HTML pages whenever worker is reloaded

  crons: ["30 * * * *"], // CRON expression for triggering scheduled events

  buildCommand: "npm run build", // Command to build project
  buildBasePath: "./build", // Working directory for build command
  buildWatchPaths: ["./src"], // Directory to watch for rebuilding on changes

  kvNamespaces: ["TEST_NAMESPACE"], // KV namespace to bind
  kvPersist: "./kv-data", // Persist KV data (to optional path)

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

  envPath: true, // Load environment variables from .env
  envPath: "./env.custom", // ...or custom .env path

  bindings: { SECRET: "sssh" }, // Binds variable/secret to environment
  globals: { LOG: () => console.log("magic") }, // Binds variable/secret to global scope
  wasmBindings: { ADD_MODULE: "./add.wasm" }, // WASM module to bind
});

await mf.reload(); // Reload scripts and configuration files

await mf.setOptions({ kvNamespaces: ["TEST_NAMESPACE2"] }); // Apply options and reload

const globalScope = await mf.getGlobalScope(); // Get sandbox's global scope
const bindings = await mf.getBindings(); // Get bindings (KV/Durable Object namespaces, variables, etc)

const exports = await mf.getModuleExports(); // Get exports from entry module

const mount = await mf.getMount("api"); // Get mounted MiniflareCore instance
await mount.getBindings();

// Dispatch "fetch" event to worker
const res = await mf.dispatchFetch("http://localhost:8787/", {
  headers: { Authorization: "Bearer ..." },
});
const text = await res.text();
const resWaitUntil = await res.waitUntil(); // Get `waitUntil`ed promises

// Dispatch "scheduled" event to worker
const waitUntil = await mf.dispatchScheduled(Date.now(), "30 * * * *");

const TEST_NAMESPACE = await mf.getKVNamespace("TEST_NAMESPACE");

const caches = await mf.getCaches(); // Get global `CacheStorage` instance
const defaultCache = caches.default;
const namedCache = await caches.open("name");

// Get Durable Object namespace and storage for ID
const TEST_OBJECT = await mf.getDurableObjectNamespace("TEST_OBJECT");
const id = TEST_OBJECT.newUniqueId();
const storage = await mf.getDurableObjectStorage(id);

const server = await mf.createServer(); // Create http.Server instance
server.listen(8787, () => {});

const server2 = await mf.startServer(); // Create and start http.Server instance
server2.close();

const scheduler = await mf.startScheduler(); // Start CRON scheduler
await scheduler.dispose();

await mf.dispose(); // Cleanup storage database connections and watcher
```
