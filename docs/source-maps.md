# 🗺 Source Maps

Source maps allow error stack traces to include the actual location in the
source an error occurred, as opposed to somewhere in the bundled output. See
[this page](https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map)
for more details.

## Enabling Source Map Support

When using the CLI, source maps are always enabled automatically. 🎉

When using the API, source maps can be enabled with the `sourceMap` option. Note
this will install source map support **globally** in your entire application:

```js
const mf = new Miniflare({
  sourceMap: true,
});
```

## Outputting Source Maps

How you generated source maps depends on your build tool. Here is how you do it
for some popular tools.

### esbuild

Use the `--sourcemap` flag or the
[`sourcemap` option](https://esbuild.github.io/api/#sourcemap).

### Webpack

See the
[`devtool` configuration option](https://webpack.js.org/configuration/devtool/).
Note that `eval` is unsupported in workers.

### Rollup

Use the `--sourcemap` flag or the
[`output.sourcemap` option](https://rollupjs.org/guide/en/#configuration-files).

### TypeScript

Use the `--sourceMap` flag or the
[`sourceMap` option](https://www.typescriptlang.org/tsconfig#sourceMap).
