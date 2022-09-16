import childProcess from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import test from "ava";
import { MiniflareOptions } from "miniflare";

const fixturesPath = path.join(__dirname, "..", "..", "test", "fixtures");

async function findJest() {
  let pkgPath = path.dirname(require.resolve("jest"));
  while (!existsSync(path.join(pkgPath, "package.json"))) {
    pkgPath = path.dirname(pkgPath);
  }
  const pkgJson = await fs.readFile(path.join(pkgPath, "package.json"), "utf8");
  const pkg = JSON.parse(pkgJson);
  return path.resolve(pkgPath, pkg.bin);
}

const jestPathPromise = findJest();

async function runJest(
  match: string,
  options: MiniflareOptions = {},
  cwd = fixturesPath
): Promise<[exitCode: number, output: string]> {
  const jestPath = await jestPathPromise;
  return new Promise((resolve) => {
    const jest = childProcess.spawn(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--no-warnings",
        jestPath,
        match,
        "--verbose",
        "--testEnvironment",
        "miniflare",
        "--testEnvironmentOptions",
        JSON.stringify(options),
      ],
      { cwd, env: { ...process.env, NPX_IMPORT_QUIET: "true" } }
    );
    let output = "";
    jest.stdout.on("data", (data) => (output += data));
    jest.stderr.on("data", (data) => (output += data));
    jest.on("close", (exitCode) => resolve([exitCode ?? -1, output]));
  });
}

test.serial(
  "MiniflareEnvironment: runs Jest tests with Service Worker format workers",
  async (t) => {
    const [exitCode, output] = await runJest(".worker.spec.js", {
      kvNamespaces: ["TEST_NAMESPACE"],
      d1Databases: ["__D1_BETA__DB_1"],
      sitePath: fixturesPath,
      globals: { KEY: "value" },
      // Check persistence options ignored
      kvPersist: true,
      cachePersist: true,
    });
    t.is(exitCode, 0, output);
    // Check using Jest's console
    t.regex(output, /console\.log\n +hello!/);
  }
);

test.serial(
  "MiniflareEnvironment: runs Jest tests with ES Module format workers",
  async (t) => {
    const [exitCode, output] = await runJest(".module.spec.js", {
      modules: true,
      scriptPath: path.join(fixturesPath, "module-worker.js"),
      durableObjects: { TEST_OBJECT: "TestObject" },
      // Check persistence options ignored
      durableObjectsPersist: true,
    });
    t.is(exitCode, 0, output);
  }
);

test.serial(
  "MiniflareEnvironment: auto-loads wrangler.toml, package.json and .env files",
  async (t) => {
    const [exitCode, output] = await runJest(
      "autoload.spec.js",
      {},
      path.join(fixturesPath, "autoload")
    );
    t.is(exitCode, 0, output);
  }
);

test.serial("NodeEnvironment: runs Miniflare integration tests", async (t) => {
  const [exitCode, output] = await runJest("node.spec.js", {});
  t.is(exitCode, 0, output);
});
