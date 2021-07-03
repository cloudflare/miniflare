# 📚 Modules

- [Modules Reference](https://developers.cloudflare.com/workers/cli-wrangler/configuration#modules)

## Enabling Modules

Miniflare supports both the traditional `service-worker` and newer `modules`
formats for writing workers. To use the `modules` format, enable it with:

```shell
$ miniflare --modules
```

```toml
# wrangler.toml
[build.upload]
format = "modules"
```

```js
const mf = new Miniflare({
  modules: true,
});
```

When using the API you must also pass the **`--experimental-vm-modules`** flag
to NodeJS. This is added automatically when using the CLI.

You can now use `modules` worker scripts like the following:

```js
export default {
  async fetch(request, env, ctx) {
    // - `request` is the incoming `Request` instance
    // - `env` contains bindings, KV namespaces, Durable Objects, etc
    // - `ctx` contains `waitUntil` and `passThroughOnException` methods
    return new Response("Hello Miniflare!");
  },
  async scheduled(controller, env, ctx) {
    // - `controller` contains `scheduledTime` and `cron` properties
    // - `env` contains bindings, KV namespaces, Durable Objects, etc
    // - `ctx` contains the `waitUntil` method
    console.log("Doing something scheduled...");
  },
};
```

<!--prettier-ignore-start-->
::: warning
When using the API, string scripts via the `script` option are supported using
the `modules` format, but you cannot import other modules using them. You  must
use a script file via the `scriptPath` option for this.
:::
<!--prettier-ignore-end-->

## Module Rules

Miniflare supports all module types: `ESModule`, `CommonJS`, `Text`, `Data` and
`CompiledWasm`. You can specify additional module resolution rules as follows:

```shell
# Note all rules implicitly have the `fallthrough` option set to true
$ miniflare --modules-rule "ESModule=**/*.js" --modules-rule "Text=**/*.txt"
```

```toml
# wrangler.toml
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

<!--prettier-ignore-start-->
::: warning
`CommonJS` modules are handled by transforming them to ES modules using
[wessberg/cjstoesm](https://github.com/wessberg/cjstoesm). Ideally, you should
just use ES modules instead to avoid this extra transformation step. Note that
`.js` files are handled as `CommonJS` modules by default.
:::
<!--prettier-ignore-end-->
