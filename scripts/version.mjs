import assert from "assert";
import fs from "fs/promises";
import path from "path";
import {
  getPackage,
  pkgsDir,
  pkgsList,
  projectRoot,
  scope,
  setPackage,
} from "./common.mjs";

const argv = process.argv.slice(2);
const version = argv[0];
assert(version);

/**
 * Returns true if this name belongs to a Miniflare package
 * @param {string} name
 * @returns {boolean}
 */
function isMiniflarePkg(name) {
  return (
    name.startsWith(scope) ||
    name === "miniflare" ||
    name === "jest-environment-miniflare" ||
    name === "vitest-environment-miniflare"
  );
}

/**
 * Updates the version number for all scoped dependencies in <dependencies>
 * @param {string} newVersion
 * @param {Record<string, string>} dependencies
 */
function updateDependencyVersions(newVersion, dependencies) {
  for (const dependency in dependencies) {
    if (dependencies.hasOwnProperty(dependency) && isMiniflarePkg(dependency)) {
      dependencies[dependency] = newVersion;
    }
  }
}

/**
 * Updates the version number for all packages and dependencies
 * @param {string} newVersion
 * @returns {Promise<void>}
 */
async function updateVersions(newVersion) {
  // Update root package
  console.log("--> Updating root's version...");
  const rootPkg = await getPackage(projectRoot);
  rootPkg.version = newVersion;
  await setPackage(projectRoot, rootPkg);

  // Update package-lock.json
  console.log("--> Updating package-lock.json's versions...");
  const pkgLockPath = path.join(projectRoot, "package-lock.json");
  const pkgLock = JSON.parse(await fs.readFile(pkgLockPath, "utf8"));
  pkgLock.version = newVersion;
  for (const [pkgPath, pkg] of Object.entries(pkgLock.packages)) {
    if (
      (pkg.name && isMiniflarePkg(pkg.name)) ||
      pkgPath === "packages/miniflare"
    ) {
      pkg.version = newVersion;
      updateDependencyVersions(newVersion, pkg.dependencies);
      updateDependencyVersions(newVersion, pkg.devDependencies);
      updateDependencyVersions(newVersion, pkg.peerDependencies);
      updateDependencyVersions(newVersion, pkg.optionalDependencies);
    }
  }
  for (const [pkgName, pkg] of Object.entries(pkgLock.dependencies)) {
    if (isMiniflarePkg(pkgName)) {
      updateDependencyVersions(newVersion, pkg.requires);
    }
  }
  await fs.writeFile(
    pkgLockPath,
    JSON.stringify(pkgLock, null, 2) + "\n",
    "utf8"
  );

  // Update sub-packages
  for (const name of pkgsList) {
    console.log(`--> Updating ${name}'s version...`);
    const pkgRoot = path.join(pkgsDir, name);
    const pkg = await getPackage(pkgRoot);
    pkg.version = newVersion;

    // Update package dependency versions
    updateDependencyVersions(newVersion, pkg.dependencies);
    updateDependencyVersions(newVersion, pkg.devDependencies);
    updateDependencyVersions(newVersion, pkg.peerDependencies);
    updateDependencyVersions(newVersion, pkg.optionalDependencies);

    await setPackage(pkgRoot, pkg);
  }
}

await updateVersions(version);
