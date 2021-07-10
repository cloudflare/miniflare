#!/usr/bin/env node
import childProcess from "child_process";
import path from "path";

/* Spawn a new process using the same NodeJS executable and passing the same
 * command line arguments, but with the "--experimental-vm-modules" flag which
 * is required for modules support.
 *
 * This is the only way I can think of doing this cross-platform. On Mac/Linux,
 * we can use "#!/usr/bin/env -S node --experimental-vm-modules" as a shebang,
 * but this won't work on Windows (or older Linux versions, e.g. Ubuntu 18.04).
 * */
childProcess
  .spawn(
    process.execPath,
    [
      "--experimental-vm-modules",
      path.join(__dirname, "cli.js"),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" }
  )
  .on("exit", (code) => process.exit(code ?? 0));
