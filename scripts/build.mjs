import { promises as fs } from "fs";
import path from "path";
import esbuild from "esbuild";
import { getPackage, pkgsDir, pkgsList, projectRoot } from "./common.mjs";

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
  // Look for test files ending with .spec.ts in the test directory
  const testPaths = (await walk(path.join(pkgRoot, "test"))).filter(
    (testPath) => testPath.endsWith(".spec.ts")
  );
  // Make sure built source files are always in dist/src even when there aren't
  // any tests
  const outPath =
    testPaths.length === 0
      ? path.join(pkgRoot, "dist", "src")
      : path.join(pkgRoot, "dist");

  const commonBuildOptions = {
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
  };

  const entryPoints = [indexPath, ...testPaths];
  if (pkg.entryPoints) {
    entryPoints.push(...pkg.entryPoints.map((e) => path.join(pkgRoot, e)));
  }
  await esbuild.build({
    ...commonBuildOptions,
    entryPoints,
    outdir: outPath,
  });
}

/**
 * Builds an AVA config including TypeScript rewrite paths for all packages.
 * Even though ava.config.js has the .js extension, you can't load any modules
 * in it, so we can't access the file system to do this there. This will change
 * in AVA version 4.
 * @returns {Promise<void>}
 */
async function buildAVAConfig() {
  const rewritePaths = Object.fromEntries(
    pkgsList.map((name) => [
      `packages/${name}/test/`,
      `packages/${name}/dist/test/`,
    ])
  );
  // TODO: need to update this to work with ESM
  const avaConfig = {
    files: ["packages/*/test/**/*.spec.ts"],
    // Long timeout for initial (uncached) Rust worker build
    timeout: "5m",
    nodeArguments: ["--experimental-vm-modules"],
    typescript: {
      compile: false,
      rewritePaths,
    },
  };
  const avaConfigJSON = JSON.stringify(avaConfig, null, 2);
  const contents = `/* eslint-disable */\nexport default ${avaConfigJSON};`;
  await fs.writeFile(path.join(projectRoot, "ava.config.js"), contents, "utf8");
}

// Bundle all packages, optionally watching, and AVA config
await Promise.all([
  ...pkgsList.map((pkgName) => buildPackage(pkgName)),
  buildAVAConfig(),
]);
