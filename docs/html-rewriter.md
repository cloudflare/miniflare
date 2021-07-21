# 📄 HTMLRewriter

- [`HTMLRewriter` Reference](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter)

Miniflare includes `HTMLRewriter` in its sandbox. It's powered by
[`html-rewriter-wasm`](https://github.com/mrbbot/html-rewriter-wasm), which uses
a WebAssembly version of [`lol-html`](https://github.com/cloudflare/lol-html),
the same library Cloudflare Workers use for their `HTMLRewriter`.
