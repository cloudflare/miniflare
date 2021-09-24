# Miniflare 2 TODO List

- [x] Monorepo: split into smaller subpackages
- [x] Dependency cleanup and switch to `undici`
- [ ] Unit testing for workers with Jest: https://jestjs.io/docs/configuration#testenvironment-string
- [x] CommonJS loader
- [x] New storage layer: move transactions to database
- [ ] Add remote KV storage
- [ ] Proxy `Symbol.hasInstance` for cross-realm `instanceof`
- [ ] Durable Object gates, `blockConcurrencyWhile`, etc
- [x] Restrict Durable Object IDs to objects they were created for
- [x] Use V8's (de)serializer for Durable Object storage
- [ ] Wrangler compatibility flag support
- [x] Disable global event handling functions when modules mode active
- [x] Use same error messages as runtime
- [ ] Make some error messages more helpful, suggest fixes
- [ ] Make WebSocket implementation behave more like workers
- [ ] Live reload?
