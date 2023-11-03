---
order: 2
---

# 🔑 Variables and Secrets

## Bindings

Variable and secrets are bound as follows:

```js
const mf = new Miniflare({
  bindings: {
    KEY1: "value1",
    KEY2: "value2",
  },
});
```

## `.env` Files

Variables and secrets are automatically loaded from a `.env` file in the current
directory. This is especially useful for secrets if your `.env` file is
`.gitignore`d. `.env` files look something like this:

```toml
KEY1=value1
# Woah, comments!
KEY2=value2
```

You can also specify the path to a custom `.env` file:

```js
const mf = new Miniflare({
  envPath: ".env.test",
});
```

## Text and Data Blobs

Text and data blobs can be loaded from files. File contents will be read and
bound as `string`s and `ArrayBuffer`s respectively.

```js
const mf = new Miniflare({
  textBlobBindings: { TEXT: "text.txt" },
  dataBlobBindings: { DATA: "data.bin" },
});
```

## Bindings Priority

Higher priority bindings override lower priority bindings with the same name.
The order (from lowest to highest priority) is:

1. Variables from `wrangler.toml` `[vars]`
2. Variables from `.env` files
3. WASM module bindings (`--wasm`, `[wasm_modules]`)
4. Text blob bindings (`--text-blob`, `[text_blobs]`)
5. Data blob bindings (`--data-blob`, `[data_blobs]`)
6. Custom bindings (`--binding`, `bindings`)

## Globals

Injecting arbitrary globals is not supported by [workerd](https://github.com/cloudflare/workerd). If you're using a service worker, bindings will be injected as globals, but these must be JSON-serialisable.

<Aside header="Tip">

Miniflare will always set the global variable `MINIFLARE` to `true` in its
sandbox. You can use this as an escape hatch to customise behaviour during local
development:

```js
if (globalThis.MINIFLARE) {
  // Do something when running in Miniflare
} else {
  // Do something else when running in the real Workers environment
}
```

</Aside>
