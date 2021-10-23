import fs from "fs/promises";
import path from "path";
import esbuild from "esbuild";
import { getPackage, pkgsDir, pkgsList, projectRoot } from "./common.js";

const argv = process.argv.slice(2);
const watch = argv[0] === "watch";

/**
 * Recursively walks a directory, returning a list of all files contained within
 * @param {string} rootPath
 * @returns {Promise<string[]>}
 */
async function walk(rootPath) {
  const fileNames = await fs.readdir(rootPath);
  const walkPromises = fileNames.map(async (fileName) => {
    const filePath = path.join(rootPath, fileName);
    return (await fs.stat(filePath)).isDirectory()
      ? await walk(filePath)
      : [filePath];
  });
  return (await Promise.all(walkPromises)).flat();
}

/**
 * Gets a list of dependency names from the passed package
 * @param {~Package} pkg
 * @param {boolean} [includeDev]
 * @returns {string[]}
 */
function getPackageDependencies(pkg, includeDev) {
  return [
    ...(pkg.dependencies ? Object.keys(pkg.dependencies) : []),
    ...(includeDev && pkg.devDependencies
      ? Object.keys(pkg.devDependencies)
      : []),
    ...(pkg.peerDependencies ? Object.keys(pkg.peerDependencies) : []),
    ...(pkg.optionalDependencies ? Object.keys(pkg.optionalDependencies) : []),
  ];
}

/**
 * Common build options for all packages
 * @type {esbuild.BuildOptions}
 */
const buildOptions = {
  format: "esm",
  // outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "esnext",
  bundle: true,
  sourcemap: true,
  sourcesContent: false,
  // minify: true,
  // minifySyntax: true,
  // minifyWhitespace: true,
  // Mark root package's dependencies as external, include root devDependencies
  // (e.g. test runner) as we don't want these bundled
  external: [...getPackageDependencies(await getPackage(projectRoot), true)],
  logLevel: watch ? "info" : "warning",
  watch,
};

/**
 * Builds a package and its tests stored in packages/<name>/
 * @param {string} name
 * @returns {Promise<void>}
 */
async function buildPackage(name) {
  const pkgRoot = path.join(pkgsDir, name);
  const pkg = await getPackage(pkgRoot);

  const indexPath = path.join(pkgRoot, "src", "index.ts");
  // Look for test files ending with .spec.ts in the test directory, default to
  // empty array if not found
  let testPaths = [];
  try {
    testPaths = (await walk(path.join(pkgRoot, "test"))).filter((testPath) =>
      testPath.endsWith(".spec.ts")
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const outPath = path.join(pkgRoot, "dist");

  const entryPoints = [indexPath, ...testPaths];
  if (pkg.entryPoints) {
    entryPoints.push(...pkg.entryPoints.map((e) => path.join(pkgRoot, e)));
  }
  await esbuild.build({
    ...buildOptions,
    external: [
      // Extend root package's dependencies with this package's
      ...buildOptions.external,
      // Exclude devDependencies, we'll use these to signal single-use/small
      // packages we want inlined in the bundle
      ...getPackageDependencies(pkg),
      // Make sure we're not bundling any packages we're building, we want to
      // test against the actual code we'll publish for instance
      "miniflare",
      "@miniflare/*",
    ],
    entryPoints,
    outdir: outPath,
    outbase: pkgRoot,
  });
}

// Bundle all packages, optionally watching
await Promise.all(pkgsList.map((pkgName) => buildPackage(pkgName)));
