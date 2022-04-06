---
order: 2
---

# 🔑 Variables and Secrets

## Bindings

Variable and secrets are bound as follows:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --binding KEY1=value1 --binding KEY2=value2 # or -b
```

```toml
---
filename: wrangler.toml
---
[vars]
KEY1 = "value1"
KEY2 = "value2"
NUMBER = 42 # Note [vars] are automatically stringified
```

```js
const mf = new Miniflare({
  bindings: {
    KEY1: "value1",
    KEY2: "value2",
  },
});
```

</ConfigTabs>

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

<ConfigTabs>

```sh
$ miniflare --env .env.test # or -e
```

```toml
---
filename: wrangler.toml
---
[miniflare]
env_path = ".env.test"
```

```js
const mf = new Miniflare({
  envPath: ".env.test",
});
```

</ConfigTabs>

## Text and Data Blobs

Text and data blobs can be loaded from files. File contents will be read and
bound as `string`s and `ArrayBuffer`s respectively.

<ConfigTabs>

```sh
$ miniflare --text-blob TEXT=text.txt --data-blob DATA=data.bin
```

```toml
---
filename: wrangler.toml
---
[text_blobs]
TEXT = "text.txt"
[data_blobs]
DATA = "data.bin"
```

```js
const mf = new Miniflare({
  textBlobBindings: { TEXT: "text.txt" },
  dataBlobBindings: { DATA: "data.bin" },
});
```

</ConfigTabs>

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

You can also bind variables or arbitrary objects to the global scope, even in
modules mode:

<ConfigTabs>

```sh
$ miniflare --global KEY1=value1 --global KEY2=value2
```

```toml
---
filename: wrangler.toml
---
[miniflare.globals]
KEY1 = "value1"
KEY2 = "value2"
```

```js
const mf = new Miniflare({
  globals: {
    KEY1: "value1",
    KEY2: "value2",
    FUNCTION: () => { ... }
  },
});
```

</ConfigTabs>

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
