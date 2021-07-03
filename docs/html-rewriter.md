# 📄 HTMLRewriter

- [`HTMLRewriter` Reference](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter)

Miniflare includes `HTMLRewriter` in its sandbox. It is powered by
[@worker-tools/parsed-html-rewriter](https://github.com/worker-tools/parsed-html-rewriter).
Note this isn't a streaming parser: the entire document is parsed, then
rewritten. This makes it slower and more memory inefficient than the actual
implementation. This also means the order handlers are called may be different
to real workers.

Ideally, we would use a WebAssembly version of
[lol-html](https://github.com/cloudflare/lol-html), the actual streaming parser
Cloudflare Workers use, but this
[isn't available yet](https://github.com/cloudflare/lol-html/issues/38).
