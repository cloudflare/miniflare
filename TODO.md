# Miniflare 2 TODO List

## Beta 1

- [x] Monorepo: split into smaller subpackages
- [x] Dependency cleanup and switch to `undici`
- [x] CommonJS loader
- [x] New storage layer: move transactions to database
- [x] Proxy `Symbol.hasInstance` for cross-realm `instanceof`
- [x] Use V8's (de)serializer for Durable Object storage
- [x] Disable global event handling functions when modules mode active
- [x] Use same error messages as runtime
- [x] Make WebSocket implementation behave more like workers
- [x] Restrict Durable Object IDs to objects they were created for
- [x] Durable Object gates, `blockConcurrencyWhile`, etc
- [ ] Live reload with HTMLRewriter, in http-server package
- [ ] Wrangler compatibility flag support
- [ ] Package descriptions & JSDocs (automatically include in READMEs?)

## Beta 2

- [ ] Unit testing for workers with Jest:
      https://jestjs.io/docs/configuration#testenvironment-string
- [ ] Multiple workers & Durable Object `script_name` option
- [ ] Make some error messages more helpful, suggest fixes
- [ ] Add remote KV storage
- [ ] Multiple Miniflare processes, Durable Object coordination
