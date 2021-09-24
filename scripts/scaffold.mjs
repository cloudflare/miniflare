import assert from "assert";
import fs from "fs/promises";
import path from "path";
import {
  getPackage,
  pkgsDir,
  projectRoot,
  scope,
  setPackage,
} from "./common.mjs";

const argv = process.argv.slice(2);
const name = argv[0];
assert(name);

const rootPkg = await getPackage(projectRoot);

/**
 * Scaffolds out a sub-package for new functionality
 * @param {string} unscopedPkgName
 * @returns {Promise<void>}
 */
async function scaffoldPackage(unscopedPkgName) {
  const pkgRoot = path.join(pkgsDir, unscopedPkgName);
  const srcRoot = path.join(pkgRoot, "src");
  const testRoot = path.join(pkgRoot, "test");

  await fs.mkdir(pkgRoot, { recursive: true });
  await fs.mkdir(srcRoot);
  await fs.mkdir(testRoot);

  const pkg = {
    name: `${scope}/${unscopedPkgName}`,
    version: rootPkg.version,
    description: "",
    keywords: ["cloudflare", "workers", "worker", "local", "cloudworker"],
    author: "MrBBot <me@mrbbot.dev>",
    license: "MIT",
    type: "module",
    exports: "./dist/src/index.js",
    types: "./dist/src/index.d.ts",
    files: ["./dist/src"],
    publishConfig: { access: "public" },
    repository: {
      type: "git",
      url: "git+https://github.com/mrbbot/miniflare.git",
      directory: `packages/${unscopedPkgName}`,
    },
    bugs: { url: "https://github.com/mrbbot/miniflare/issues" },
    homepage: `https://github.com/mrbbot/miniflare/tree/master/packages/${unscopedPkgName}#readme`,
    volta: { extends: "../../package.json" },
    dependencies: { [`${scope}/shared`]: rootPkg.version },
  };
  await setPackage(pkgRoot, pkg);

  await fs.writeFile(
    path.join(pkgRoot, "README.md"),
    `# \`@miniflare/${unscopedPkgName}\`\n`,
    "utf8"
  );
  await fs.writeFile(path.join(srcRoot, "index.ts"), "export {};\n", "utf8");

  console.log(`\x1b[32mScaffolded ${scope}/${unscopedPkgName}\x1b[39m`);
}

await scaffoldPackage(name);
