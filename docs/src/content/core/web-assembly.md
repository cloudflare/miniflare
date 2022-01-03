---
order: 5
---

# ⚙️ WebAssembly

## Bindings

WebAssembly modules are bound as follows. The bound keys will be instances of
[WebAssembly.Module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module):

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```sh
$ miniflare --wasm MODULE1=module1.wasm --wasm MODULE2=module2.wasm
```

```toml
---
filename: wrangler.toml
---
[wasm_modules]
MODULE1 = "module1.wasm"
MODULE2 = "module2.wasm"
```

```js
const mf = new Miniflare({
  wasmBindings: {
    MODULE1: "module1.wasm",
    MODULE2: "module2.wasm",
  },
});
```

</ConfigTabs>

You can then use the WebAssembly modules in your workers:

```js
---
highlight: [1,5]
---
const instance = new WebAssembly.Instance(MODULE1);

addEventListener("fetch", (e) => {
  // Assuming MODULE1 exports a function `add` summing 2 integer arguments
  const value = instance.exports.add(1, 2);
  e.respondWith(new Response(value.toString()));
});
```

## Modules

You can also import WebAssembly modules by adding a `CompiledWasm` module rule.
See [📚 Modules](/core/modules) for more details. For instance, with the
following `wrangler.toml` file and worker script, we can achieve the same result
as the previous example:

```toml
---
filename: wrangler.toml
---
[[build.upload.rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
```

```js
---
highlight: [1,2,3,7]
---
import module1 from "./module1.wasm";

const instance = new WebAssembly.Instance(module1);

export default {
  fetch() {
    const value = instance.exports.add(1, 2);
    return new Response(value.toString());
  },
};
```

## `instanceof` Checks

When accessing JavaScript objects from WebAssembly, glue code (what
`wasm-bingen` generates) often needs to check values' types using `instanceof`.
Due to how Miniflare works, these checks will fail for primitive classes like
`Object` if values are created outside the Miniflare sandbox (in a different
JavaScript realm). For example,
`caches.default.match("https://miniflare.dev") instanceof Object` will always be
`false` even if the request is cached, since the returned `Response` object is
created outside the sandbox. To fix this, enable the `proxyPrimitiveInstanceOf`
option:

<ConfigTabs>

```sh
$ miniflare --proxy-primitive
```

```toml
---
filename: wrangler.toml
---
[miniflare]
proxy_primitive_instanceof = true
```

```js
const mf = new Miniflare({
  proxyPrimitiveInstanceOf: true,
});
```

</ConfigTabs>

This proxies `instanceof` checks for primitive classes, so they succeed
regardless of the realm the object is created in. See
[this comment](https://github.com/cloudflare/miniflare/blob/720794accee7582b01e849182244a65ce60c9d60/packages/core/src/plugins/core.ts#L487-L555)
for more details.

<Aside type="warning" header="Warning">

Enabling this option will cause primitive class `constructor` and `prototype`
checks to fail:

```js
{}.constructor === Object; // false
Object.getPrototypeOf({}) === Object.prototype; // false
```

</Aside>

## Rust Wrangler Builds

When using [Rust Wrangler Builds](/developing/builds#rust), `wasm` is
automatically bound to your compiled WebAssembly module. The
`proxyPrimitiveInstanceOf` option is also automatically enabled.
