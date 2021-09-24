import assert from "assert";
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
 * Updates the version number for all scoped dependencies in <dependencies>
 * @param {string} newVersion
 * @param {Record<string, string>} dependencies
 */
function updateDependencyVersions(newVersion, dependencies) {
  for (const dependency in dependencies) {
    if (
      dependencies.hasOwnProperty(dependency) &&
      dependency.startsWith(scope)
    ) {
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
