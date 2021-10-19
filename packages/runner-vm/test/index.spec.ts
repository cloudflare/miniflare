import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { VMScriptRunner } from "@miniflare/runner-vm";
import test from "ava";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.join(__dirname, "..", "..", "test", "fixtures");

const runner = new VMScriptRunner();

test("VMScriptRunner: run: runs scripts in sandbox", async (t) => {
  t.plan(4);
  const result = await runner.run(
    { callback: (result: string) => t.is(result, "test") },
    { code: 'callback("test")', filePath: "test.js" }
  );
  t.deepEqual(result.exports, {});
  t.is(result.bundleSize, 'callback("test")'.length);
  t.is(result.watch, undefined);
});
test("VMScriptRunner: run: runs modules in sandbox", async (t) => {
  t.plan(4);
  const result = await runner.run(
    { callback: (result: string) => t.is(result, "test") },
    { code: 'callback("test"); export default 42;', filePath: "test.js" },
    []
  );
  t.is(result.exports.default, 42);
  t.is(result.bundleSize, 'callback("test"); export default 42;'.length);
  t.deepEqual(result.watch, []);
});
test("VMScriptRunner: run: includes script file name in stack traces", async (t) => {
  try {
    await runner.run(
      {},
      { code: 'throw new Error("test")', filePath: "test.js" }
    );
    t.fail();
  } catch (e: any) {
    t.regex(e.stack, /at test\.js:1/);
  }
});
test("VMScriptRunner: run: includes module file name in stack traces", async (t) => {
  try {
    await runner.run(
      {},
      { code: 'throw new Error("test")', filePath: "test.js" },
      []
    );
    t.fail();
  } catch (e: any) {
    t.true(e.stack.includes("at test.js:1"));
  }
});
test("VMScriptRunner: run: disallows dynamic JavaScript execution", async (t) => {
  const result = runner.run(
    { callback: () => t.fail() },
    { code: 'eval("callback()")', filePath: "test.js" }
  );
  await t.throwsAsync(result, {
    message: "Code generation from strings disallowed for this context",
  });
});
test("VMScriptRunner: run: disallows WebAssembly compilation", async (t) => {
  const addModule = await fs.readFile(path.join(fixturesPath, "add.wasm"));
  const result = runner.run(
    { addModule },
    { code: "await WebAssembly.compile(addModule)", filePath: "test.js" },
    []
  );
  await t.throwsAsync(result, {
    message:
      "WebAssembly.compile(): Wasm code generation disallowed by embedder",
  });
});
test("VMScriptRunner: run: supports cross-realm instanceof", async (t) => {
  const result = await runner.run(
    { outsideRegexp: /a/ },
    {
      code: `
      export const outsideInstanceOf = outsideRegexp instanceof RegExp;
      export const insideInstanceOf = /a/ instanceof RegExp;
      `,
      filePath: "test.js",
    },
    []
  );
  t.true(result.exports.outsideInstanceOf);
  t.true(result.exports.insideInstanceOf);
});
