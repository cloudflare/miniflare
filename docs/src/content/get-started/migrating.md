---
order: 3
---

# ⬆️ Migrating from Version 2

Miniflare v3 now uses [`workerd`](https://github.com/cloudflare/workerd), the
open-source Cloudflare Workers runtime. This is the same runtime that's deployed
on Cloudflare’s network, giving bug-for-bug compatibility and practically
eliminating behavior mismatches. Refer to the
[Miniflare v3](https://blog.cloudflare.com/miniflare-and-workerd/) and
[Wrangler v3 announcements](https://blog.cloudflare.com/wrangler3/) for more
information.

## Missing Features

Several features from Miniflare v2 are not supported in Miniflare v3's initial
release. However, they are on the roadmap, and will be added soon:

- Step-through debugging
- Automatically triggering scheduled events via CRON schedules, or manually
  triggering them via `/.mf/scheduled` or `/cdn-cgi/mf/scheduled` (manually
  triggering events is supported via the `--test-scheduled` Wrangler flag and
  visiting `/__scheduled`)
- Starting an HTTPS server

## CLI Changes

Miniflare v3 no longer includes a standalone CLI. To get the same functionality,
you will need to switch over to
[Wrangler](https://developers.cloudflare.com/workers/wrangler/). Wrangler v3
uses Miniflare v3 by default. To start a local development server, run:

```sh
$ npx wrangler@3 dev
```

If there are features from the Miniflare CLI you would like to see in Wrangler,
please open an issue on
[GitHub](https://github.com/cloudflare/workers-sdk/issues/new/choose).

## API Changes

We have tried to keep Miniflare v3’s API close to Miniflare v2 where possible,
but many options and methods have been removed or changed with the switch to the
open-source `workerd` runtime. See the
[GitHub `README` for the new API docs](https://github.com/cloudflare/miniflare/blob/tre/packages/miniflare/README.md).

### Updated Options

<!-- prettier-ignore-start -->

<Definitions>

- `kvNamespaces/r2Buckets/d1Databases`
  - In addition to `string[]`s, these options now accept
    `Record<string, string>`s, mapping binding names to namespace IDs/bucket
    names/database IDs. This means multiple Workers can bind to the same
    namespace/bucket/database under different names.
- `queueBindings`
  - Renamed to `queueProducers`. This either accepts a `Record<string, string>`
    mapping binding names to queue names, or a `string[]` of binding names to
    queues of the same name.
- `queueConsumers`
  - Either accepts a `Record<string, QueueConsumerOptions>` mapping queue names
    to consumer options, or a `string[]` of queue names to consume with default
    options. `QueueConsumerOptions` has the following type:

    ```ts
    interface QueueConsumerOptions {
      // https://developers.cloudflare.com/queues/platform/configuration/#consumer
      maxBatchSize?: number;                  // default: 5
      maxBatchTimeout?: number /* seconds */; // default: 1
      maxRetries?: number;                    // default: 2
      deadLetterQueue?: string;               // default: none
    }
    ```
- `cfFetch`
  - Renamed to `cf`. Either accepts a `boolean`, `string` (as before), or an
    object to use a the `cf` object for incoming requests.

</Definitions>

<!-- prettier-ignore-end -->

### Removed Options

<Definitions>

- `wranglerConfigPath/wranglerConfigEnv`
  - Miniflare no longer handles Wrangler's configuration. To programmatically
    start up a Worker based on Wrangler configuration, use the
    [`unstable_dev()`](https://developers.cloudflare.com/workers/wrangler/api/#unstable_dev)
    API.
- `packagePath`
  - Miniflare no longer loads script paths from `package.json` files. Use the
    `scriptPath` option to specify your script instead.
- `watch`
  - Miniflare's API is primarily intended for testing use cases, where file
    watching isn't usually required. This option was here to enable Miniflare’s
    CLI which has now been removed. If you need to watch files, consider using a
    separate file watcher like
    [`fs.watch()`](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)
    or [`chokidar`](https://github.com/paulmillr/chokidar), and calling
    `setOptions()` with your original configuration on change.
- `logUnhandledRejections`
  - Unhandled rejections can be handled in Workers with
    [`addEventListener("unhandledrejection")`](https://community.cloudflare.com/t/2021-10-21-workers-runtime-release-notes/318571).
- `globals`
  - Injecting arbitrary globals is not supported by
    [`workerd`](https://github.com/cloudflare/workerd). If you're using a
    service worker, `bindings` will be injected as globals, but these must be
    JSON-serialisable.
- `https/httpsKey(Path)/httpsCert(Path)/httpsPfx(Path)/httpsPassphrase`
  - Miniflare does not support starting HTTPS servers yet. These options may be
    added back in a future release.
- `crons`
  - [`workerd`](https://github.com/cloudflare/workerd) does not support
    triggering scheduled events yet. This option may be added back in a future
    release.
- `mounts`

  - Miniflare no longer has the concept of parent and child Workers. Instead,
    all Workers can be defined at the same level, using the new `workers`
    option. Here's an example that uses a service binding to increment a value
    in a shared KV namespace:

    ```ts
    import { Miniflare, Response } from "miniflare";

    const message = "The count is ";
    const mf = new Miniflare({
      // Options shared between workers such as HTTP and persistence configuration
      // should always be defined at the top level.
      host: "0.0.0.0",
      port: 8787,
      kvPersist: true,

      workers: [
        {
          name: "worker",
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
        {
          name: "incrementer",
          // Note we're using the same `COUNTS` namespace as before, but binding it
          // to `NUMBERS` instead.
          kvNamespaces: { NUMBERS: "counts" },
          // Worker formats can be mixed-and-matched
          script: `addEventListener("fetch", (event) => {
            event.respondWith(handleRequest());
          })
          async function handleRequest() {
            const count = parseInt((await NUMBERS.get("count")) ?? "0") + 1;
            await NUMBERS.put("count", count.toString());
            return new Response(count.toString());
          }`,
        },
      ],
    });
    const res = await mf.dispatchFetch("http://localhost");
    console.log(await res.text()); // "The count is 3"
    await mf.dispose();
    ```

- `metaProvider`
  - The `cf` object and `X-Forwarded-Proto`/`X-Real-IP` headers can be specified
    when calling `dispatchFetch()` instead. A default `cf` object can be
    specified using the new `cf` option too.
- `durableObjectAlarms`
  - Miniflare now always enables Durable Object alarms.
- `globalAsyncIO/globalTimers/globalRandom`
  - [`workerd`](https://github.com/cloudflare/workerd) cannot support these
    options without fundamental changes.
- `actualTime`
  - Miniflare now always returns the current time.
- `inaccurateCpu`
  - Set the `inspectorPort: 9229` option to enable the V8 inspector. Visit
    `chrome://inspect` in Google Chrome to open DevTools and perform CPU
    profiling.

</Definitions>

### Updated Methods

<Definitions>

- `setOptions()`
  - Miniflare v3 now requires a full configuration object to be passed, instead
    of a partial patch.

</Definitions>

### Removed Methods

<Definitions>

- `reload()`
  - Call `setOptions()` with the original configuration object to reload
    Miniflare.
- `createServer()/startServer()`
  - Miniflare now always starts a
    [`workerd`](https://github.com/cloudflare/workerd) server listening on the
    configured `host` and `port`, so these methods are redundant.
- `dispatchScheduled()/startScheduled()`
  - [`workerd`](https://github.com/cloudflare/workerd) does not support
    triggering scheduled events yet.
- `dispatchQueue()`
  - Use the `queue()` method on
    [service bindings](https://developers.cloudflare.com/workers/platform/bindings/about-service-bindings/)
    or
    [queue producer bindings](https://developers.cloudflare.com/queues/platform/configuration/#producer)
    instead.
- `getGlobalScope()/getBindings()/getModuleExports()`
  - These methods returned objects from inside the Workers sandbox. Since
    Miniflare now uses [`workerd`](https://github.com/cloudflare/workerd), which
    runs in a different process, these methods can no longer be supported.
- `getKVNamespace()/getR2Bucket()/getCaches()/getDurableObjectNamespace()`
  - Similarly, these methods return instances of Workers runtime classes that
    are defined in a different process, and can no longer be supported.
- `addEventListener()`/`removeEventListener()`
  - Miniflare no longer emits `reload` events. As Miniflare no longer watches
    files, reloads are only triggered by initialisation or `setOptions()` calls.
    In these cases, it's possible to wait for the reload with either
    `await mf.ready` or `await mf.setOptions()` respectively.
- `Response#waitUntil()`
  - [`workerd`](https://github.com/cloudflare/workerd) does not support waiting
    for all `waitUntil()`ed promises yet.

</Definitions>

### Removed Packages

<Definitions>

- `@miniflare/*`
  - Miniflare is now contained within a single `miniflare` package.

</Definitions>
