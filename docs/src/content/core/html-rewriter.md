---
order: 7
---

# 📄 HTMLRewriter

- [`HTMLRewriter` Reference](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter)

Miniflare includes `HTMLRewriter` in its sandbox. It's powered by
[`html-rewriter-wasm`](https://github.com/mrbbot/html-rewriter-wasm), which uses
a WebAssembly version of [`lol-html`](https://github.com/cloudflare/lol-html),
the same library Cloudflare Workers use for their `HTMLRewriter`.

<Aside type="warning" header="Warning">

If you're using `async` handlers, and a testing framework that supports running
tests in parallel, you should run tests that use `HTMLRewriter` in serial (e.g.
`test.serial` with AVA) for improved stability.

</Aside>
