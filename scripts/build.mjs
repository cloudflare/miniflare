import fs from "fs/promises";
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

const miniflareRoot = path.join(projectRoot, "packages", "miniflare");
const workersRoot = path.join(miniflareRoot, "src", "workers");

const miniflareSharedExtensionPath = path.join(
  workersRoot,
  "shared",
  "index.worker.ts"
);
const miniflareZodExtensionPath = path.join(
  workersRoot,
  "shared",
  "zod.worker.ts"
);
/**
 * `workerd` `extensions` don't have access to "built-in" modules like
 * `node:buffer`, but do have access to "internal" modules like
 * `node-internal:internal_buffer`, which usually provide the same exports.
 * So that we can use `node:assert` and `node:buffer` in our shared extension,
 * rewrite built-in names to internal.
 * @type {esbuild.Plugin}
 */
const rewriteNodeToInternalPlugin = {
  name: "rewrite-node-to-internal",
  setup(build) {
    build.onResolve({ filter: /^node:(assert|buffer)$/ }, async (args) => {
      const module = args.path.substring("node:".length);
      return { path: `node-internal:internal_${module}`, external: true };
    });
  },
};

/**
 * @type {Map<string, esbuild.BuildResult>}
 */
const workersBuilders = new Map();
/**
 * @type {esbuild.Plugin}
 */
const embedWorkersPlugin = {
  name: "embed-workers",
  setup(build) {
    const namespace = "embed-worker";
    build.onResolve({ filter: /^worker:/ }, async (args) => {
      let name = args.path.substring("worker:".length);
      // Allow `.worker` to be omitted
      if (!name.endsWith(".worker")) name += ".worker";
      // Use `build.resolve()` API so Workers can be written as `m?[jt]s` files
      const result = await build.resolve("./" + name, {
        kind: "import-statement",
        resolveDir: workersRoot,
      });
      if (result.errors.length > 0) return { errors: result.errors };
      return { path: result.path, namespace };
    });
    build.onLoad({ filter: /.*/, namespace }, async (args) => {
      let builder = workersBuilders.get(args.path);
      if (builder === undefined) {
        builder = await esbuild.build({
          platform: "node", // Marks `node:*` imports as external
          format: "esm",
          target: "esnext",
          bundle: true,
          sourcemap: true,
          sourcesContent: false,
          external: ["miniflare:shared", "miniflare:zod"],
          metafile: true,
          incremental: watch, // Allow `rebuild()` calls if watching
          entryPoints: [args.path],
          minifySyntax: true,
          outdir: build.initialOptions.outdir,
          outbase: miniflareRoot,
          plugins:
            args.path === miniflareSharedExtensionPath ||
            args.path === miniflareZodExtensionPath
              ? [rewriteNodeToInternalPlugin]
              : [],
        });
      } else {
        builder = await builder.rebuild();
      }
      workersBuilders.set(args.path, builder);
      await fs.mkdir("worker-metafiles", { recursive: true });
      await fs.writeFile(
        path.join(
          "worker-metafiles",
          path.basename(args.path) + ".metafile.json"
        ),
        JSON.stringify(builder.metafile)
      );
      let outPath = args.path.substring(workersRoot.length + 1);
      outPath = outPath.substring(0, outPath.lastIndexOf(".")) + ".js";
      outPath = JSON.stringify(outPath);
      const watchFiles = Object.keys(builder.metafile.inputs);
      const contents = `
      import fs from "fs";
      import path from "path";
      import url from "url";
      let contents;
      export default function() {
         if (contents !== undefined) return contents;
         const filePath = path.join(__dirname, "workers", ${outPath});
         contents = fs.readFileSync(filePath, "utf8") + "//# sourceURL=" + url.pathToFileURL(filePath);
         return contents;
      }
      `;
      return { contents, loader: "js", watchFiles };
    });
  },
};

/**
 * Common build options for all packages
 * @type {esbuild.BuildOptions}
 */
const buildOptions = {
  platform: "node",
  format: "cjs",
  target: "esnext",
  bundle: true,
  sourcemap: true,
  sourcesContent: false,
  tsconfig: path.join(projectRoot, "tsconfig.json"),
  // Mark root package's dependencies as external, include root devDependencies
  // (e.g. test runner) as we don't want these bundled
  external: [
    ...getPackageDependencies(await getPackage(projectRoot), true),
    // Make sure we're not bundling any packages we're building, we want to
    // test against the actual code we'll publish for instance
    "miniflare",
    "@miniflare/*",
    // Make sure all Jest packages aren't bundled
    "@jest/*",
    "jest*",
    // Mark sites manifest as external, it's added by SitesPlugin
    "__STATIC_CONTENT_MANIFEST",
  ],
  plugins: [embedWorkersPlugin],
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

  const cjsEntryPoints = [indexPath, ...testPaths];
  // Some tests require bundled ES module fixtures (e.g. Workers Sites), so
  // build .mjs/.mts files using `format: "esm"`
  const esmEntryPoints = [];
  for (const entryPoint of pkg.entryPoints ?? []) {
    (/\.m[tj]s$/.test(entryPoint) ? esmEntryPoints : cjsEntryPoints).push(
      path.join(pkgRoot, entryPoint)
    );
  }

  const pkgBuildOptions = {
    ...buildOptions,
    external: [
      // Extend root package's dependencies with this package's
      ...buildOptions.external,
      // Exclude devDependencies, we'll use these to signal single-use/small
      // packages we want inlined in the bundle
      ...getPackageDependencies(pkg),
    ],
    outdir: outPath,
    outbase: pkgRoot,
  };
  await esbuild.build({ ...pkgBuildOptions, entryPoints: cjsEntryPoints });
  if (esmEntryPoints.length) {
    await esbuild.build({
      ...pkgBuildOptions,
      format: "esm",
      entryPoints: esmEntryPoints,
    });
  }
}

// Bundle all packages, optionally watching
await Promise.all(pkgsList.map((pkgName) => buildPackage(pkgName)));
