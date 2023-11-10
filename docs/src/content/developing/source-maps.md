---
order: 1
---

# 🗺 Source Maps

Source maps allow error stack traces to include the actual location in the
source an error occurred, as opposed to somewhere in the bundled output. See
[this page](https://developer.mozilla.org/en-US/docs/Tools/Debugger/How_to/Use_a_source_map)
for more details.

## Outputting Source Maps

How you generate source maps depends on your build tool. Here's how to do it for
some popular tools:

### esbuild

Use the `--sourcemap` flag or the
[`sourcemap` option](https://esbuild.github.io/api/#sourcemap).

### Webpack

See the
[`devtool` configuration option](https://webpack.js.org/configuration/devtool/).
Note that `eval` is unsupported in workers. For the error page to correctly
resolve your source files, you must set `devtoolModuleFilenameTemplate` to
`[absolute-resource-path]`:

```js
module.exports = {
  entry: "./src/index.js",
  devtool: "cheap-module-source-map",
  output: {
    devtoolModuleFilenameTemplate: "[absolute-resource-path]",
  },
};
```

### Rollup

Use the `--sourcemap` flag or the
[`output.sourcemap` option](https://rollupjs.org/guide/en/#configuration-files).

### TypeScript

Use the `--sourceMap` flag or the
[`sourceMap` option](https://www.typescriptlang.org/tsconfig#sourceMap).
