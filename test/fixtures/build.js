/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const { build } = require("esbuild");

build({
  entryPoints: [
    path.join(__dirname, "sites.js"),
    path.join(__dirname, "sourcemap.js"),
  ],
  outdir: path.join(__dirname, "dist"),
  bundle: true,
  sourcemap: true,
  logLevel: "info",
}).catch(() => process.exit(1));
