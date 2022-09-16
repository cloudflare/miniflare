import childProcess from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import test from "ava";

const fixturesPath = path.join(__dirname, "..", "..", "test", "fixtures");

async function findVitest() {
  // TODO: try use `require.resolve("vitest")` here instead
  //  (gives `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined
  //  in .../miniflare/node_modules/vitest/package.json`)

  // Find `node_modules/vitest`
  let rootPath = __dirname;
  while (!existsSync(path.join(rootPath, "node_modules", "vitest"))) {
    rootPath = path.dirname(rootPath);
  }
  const pkgPath = path.join(rootPath, "node_modules", "vitest");

  // Find `vitest` binary
  const pkgJson = await fs.readFile(path.join(pkgPath, "package.json"), "utf8");
  const pkg = JSON.parse(pkgJson);
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.vitest;
  return path.resolve(pkgPath, bin);
}

const vitestPathPromise = findVitest();

async function runVitest(
  cwd: string
): Promise<[exitCode: number, output: string]> {
  const vitestPath = await vitestPathPromise;
  return new Promise((resolve) => {
    const vitest = childProcess.spawn(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--no-warnings",
        vitestPath,
        "run",
        "--reporter=verbose",
        "--allowOnly",
        "--no-color",
      ],
      {
        cwd,
        env: {
          ...process.env,
          NODE_OPTIONS: "--experimental-vm-modules --no-warnings",
          NPX_IMPORT_QUIET: "true",
        },
      }
    );
    let output = "";
    vitest.stdout.on("data", (data) => (output += data));
    vitest.stderr.on("data", (data) => (output += data));
    vitest.on("close", (exitCode) => resolve([exitCode ?? -1, output]));
  });
}

test.serial(
  "runs Vitest tests with Service Worker format workers",
  async (t) => {
    const [exitCode, output] = await runVitest(
      path.join(fixturesPath, "service-worker")
    );
    t.is(exitCode, 0, output);
    // Check using Vitest's console (this test is flaky on Windows)
    if (process.platform !== "win32") {
      t.regex(
        output,
        /stdout \| core\.worker\.spec\.js > uses Vitest console\nhello!/
      );
    }
    // Check `describe.each` title substitution
    t.regex(output, /each describe 1 > each describe test/);
    t.regex(output, /each describe 2 > each describe test/);
    t.regex(output, /each describe 3 > each describe test/);
  }
);

test.serial("runs Vitest tests with ES Module format workers", async (t) => {
  const [exitCode, output] = await runVitest(
    path.join(fixturesPath, "modules")
  );
  t.is(exitCode, 0, output);
});

test.serial(
  "auto-loads wrangler.toml, package.json and .env files",
  async (t) => {
    const [exitCode, output] = await runVitest(
      path.join(fixturesPath, "autoload")
    );
    t.is(exitCode, 0, output);
  }
);

test.serial("runs Miniflare integration tests", async (t) => {
  const [exitCode, output] = await runVitest(
    path.join(fixturesPath, "integration")
  );
  t.is(exitCode, 0, output);
});
