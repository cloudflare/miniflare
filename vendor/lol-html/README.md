# `lol-html`

This is a vendored WebAssembly version of
[Cloudflare's `lol-html` library](https://github.com/cloudflare/lol-html) that
powers `HTMLRewriter`. See
[`src/modules/rewriter.ts`](../../src/modules/rewriter.ts) for the actual
`HTMLRewriter` implementation.

## Build Instructions

1. Install mrbbot's fork of `wasm-pack`. This upgrades `binaryen` (`wasm-opt`)
   to `version_92` which exports `asyncify_get_state` as required by
   `GoogleChromeLabs/asyncify@1.2.0`.

   ```shell
   $ cargo install --git https://github.com/mrbbot/wasm-pack
   $ wasm-pack --version # should be wasm-pack 0.10.0-asyncify
   ```

2. Clone mrbbot's fork of `lol-html` here: https://github.com/mrbbot/lol-html.
   Make sure you're on the `js-api-0.3.0` branch. This updates the JavaScript
   API to support version `0.3.0` of `lol-html`, and adds support for async
   handlers.

3. Change into the `js-api` directory of the forked `lol-html` and build the
   project for NodeJS using the forked `wasm-pack`.

   ```shell
   $ cd js-api
   $ wasm-pack build --target nodejs
   ```

4. Still in the `js-api` directory, apply the `pkg.patch` file to the built
   package. This adds support for async handlers.

   ```shell
   $ patch -ruN -d pkg < pkg.patch
   ```

5. Copy the contents of the now patched `pkg` directory to this directory.
