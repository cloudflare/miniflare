import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// These aren't included by default in .mjs files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..");

export const pkgsDir = path.join(projectRoot, "packages");
export const pkgsList = (await fs.readdir(pkgsDir)).filter(
  (name) => name !== ".DS_Store"
);

export const scope = "@miniflare";

/**
 * @typedef {object} ~Package
 * @property {string} name
 * @property {string} version
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [peerDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {string[]} [entryPoints]
 */

/**
 * Gets the contents of the package.json file in <pkgRoot>
 * @param {string} pkgRoot
 * @returns {Promise<~Package>}
 */
export async function getPackage(pkgRoot) {
  return JSON.parse(
    await fs.readFile(path.join(pkgRoot, "package.json"), "utf8")
  );
}

/**
 * Sets the contents of the package.json file in <pkgRoot>
 * @param {string} pkgRoot
 * @param {~Package} pkg
 * @returns {Promise<void>}
 */
export async function setPackage(pkgRoot, pkg) {
  await fs.writeFile(
    path.join(pkgRoot, "package.json"),
    JSON.stringify(pkg, null, 2),
    "utf8"
  );
}
