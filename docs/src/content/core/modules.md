---
order: 3
---

# 📚 Modules

- [Modules Reference](https://developers.cloudflare.com/workers/cli-wrangler/configuration#modules)

## Enabling Modules

Miniflare supports both the traditional `service-worker` and newer `modules`
formats for writing workers. To use the `modules` format, enable it with:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[build.upload]
format = "modules"
```

```js
const mf = new Miniflare({
  modules: true,
});
```

</ConfigTabs>

When using the API you must also pass the **`--experimental-vm-modules`** flag
to Node.js. This is added automatically when using the CLI.

You can now use `modules` worker scripts like the following:

```js
export default {
  async fetch(request, env, ctx) {
    // - `request` is the incoming `Request` instance
    // - `env` contains bindings, KV namespaces, Durable Objects, etc
    // - `ctx` contains `passThroughOnException` methods
    return new Response("Hello Miniflare!");
  },
  async scheduled(controller, env, ctx) {
    // - `controller` contains `scheduledTime` and `cron` properties
    // - `env` contains bindings, KV namespaces, Durable Objects, etc
    console.log("Doing something scheduled...");
  },
};
```

<Aside type="warning" header="Warning">

String scripts via the `script` option are supported using
the `modules` format, but you cannot import other modules using them. You must
use a script file via the `scriptPath` option for this.

</Aside>

## Module Rules

Miniflare supports all module types: `ESModule`, `CommonJS`, `Text`, `Data` and
`CompiledWasm`. You can specify additional module resolution rules as follows:

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[[build.upload.rules]]
type = "ESModule"
globs = ["**/*.js"]
[[build.upload.rules]]
type = "Text"
globs = ["**/*.txt"]
```

```js
const mf = new Miniflare({
  modulesRules: [
    { type: "ESModule", include: ["**/*.js"], fallthrough: true },
    { type: "Text", include: ["**/*.txt"] },
  ],
});
```

</ConfigTabs>

### Default Rules

The following rules are automatically added to the end of your modules rules
list. You can override them by specifying rules matching the same `globs`:

```toml
[[build.upload.rules]]
type = "ESModule"
globs = ["**/*.mjs"]
[[build.upload.rules]]
type = "CommonJS"
globs = ["**/*.js", "**/*.cjs"]
```
