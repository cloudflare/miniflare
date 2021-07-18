# 📄 HTMLRewriter

- [`HTMLRewriter` Reference](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter)

Miniflare includes `HTMLRewriter` in its sandbox. It's powered by a WebAssembly
version of [`lol-html`](https://github.com/cloudflare/lol-html), the same
library Cloudflare Workers use for their `HTMLRewriter`.

## Internal Details

### Asynchronous Handlers

`HTMLRewriter` supports `async` handlers, allowing easy access to external
resources:

```js
new HTMLRewriter()
  .on("p", {
    async element(element) {
      const res = await fetch("...");
      // ...
    },
  })
  .transform(new Response("..."));
```

`lol-html` doesn't support asynchronous handlers. Instead, we have to use
stackful coroutines. Essentially, when a handler returns a `Promise`, we have to
unwind the WebAssembly stack into temporary storage, wait for the promise to
resolve, then rewind the stack and continue parsing. To do this, we use the
[Asyncify](https://kripken.github.io/blog/wasm/2019/07/16/asyncify.html) feature
of [Binaryen](https://github.com/WebAssembly/binaryen), and
[GoogleChromeLabs/asyncify](https://github.com/GoogleChromeLabs/asyncify) to
handle this in JavaScript. For an instance of a WebAssembly module,
[GoogleChromeLabs/asyncify](https://github.com/GoogleChromeLabs/asyncify) uses
the same temporary storage to store the stack. This means we cannot have
concurrent `transform` calls that use `async` handlers executing, as Asyncify
would overwrite their stacks. To solve this, we use a global mutual exclusion
lock to ensure only one `transform` call is executing at a given time. This is
usually fine since, during development, lock contention will be unlikely as only
one user is using the application. However, during testing, it may be that you
want to run tests in parallel to speed them up (e.g. using AVA). In this case,
it's possible to disable the global lock to avoid tests running serially using
the `htmlRewriterUnsafe` option. This option should only be enabled when the
worker does **NOT** use any asynchronous handlers. Note this option is only
available when using the API:

```js
const mf = new Miniflare({
  htmlRewriterUnsafe: true,
});
```

There are some potential ways to solve this problem that could be explored,
meaning this option may be removed in a future release.
