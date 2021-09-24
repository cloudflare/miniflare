#!/usr/bin/env node
import childProcess from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* Spawn a new process using the same Node.js executable and passing the same
 * command line arguments, but with required flags for source map and modules
 * support.
 *
 * This is the only cross-platform way of doing this I can think of. On
 * Mac/Linux, we can use "#!/usr/bin/env -S node ..." as a shebang, but this
 * won't work on Windows (or older Linux versions, e.g. Ubuntu 18.04). If you
 * can think of a better way of doing this, please open a GitHub issue.
 */
childProcess
  .spawn(
    process.execPath,
    // TODO: maybe pass original execPath as env variable
    [
      "--enable-source-maps", // TODO: this caches source maps, check these get flushed properly
      "--experimental-vm-modules",
      // "--no-warnings", // TODO: not sure about this, maybe only in prod?
      ...process.execArgv,
      path.join(__dirname, "cli.js"),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" }
  )
  .on("exit", (code) => process.exit(code ?? 0));
