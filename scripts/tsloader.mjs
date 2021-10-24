import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgsDir = path.resolve(__dirname, "..", "packages");

const typescriptRegexp = /packages\/([a-z-]+)\/(.+)\.ts$/;

// See https://nodejs.org/api/esm.html#esm_resolve_specifier_context_defaultresolve
// This loader resolves .ts files to their built .js files in dist
export function resolve(specifier, context, defaultResolve) {
  const match = typescriptRegexp.exec(specifier);
  if (match) {
    const jsPath = path.join(pkgsDir, match[1], "dist", match[2] + ".js");
    return { url: pathToFileURL(jsPath).toString() };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
