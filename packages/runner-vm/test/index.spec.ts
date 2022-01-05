import fs from "fs/promises";
import path from "path";
import { VMScriptRunner } from "@miniflare/runner-vm";
import test, { ThrowsExpectation } from "ava";

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
  // noinspection JSUnusedGlobalSymbols
  const globals = { callback: () => t.fail() };
  const expectations: ThrowsExpectation = {
    message: "Code generation from strings disallowed for this context",
  };

  // Check eval()
  let result = runner.run(globals, {
    code: 'eval("callback()")',
    filePath: "test.js",
  });
  await t.throwsAsync(result, expectations, "eval(...)");

  // Check new Function() via global
  result = runner.run(globals, {
    code: 'new Function("callback()")',
    filePath: "test.js",
  });
  await t.throwsAsync(result, expectations, "global new Function(...)");

  // Check new Function() via prototype
  result = runner.run(globals, {
    code: 'new (Object.getPrototypeOf(function(){}).constructor)("callback()")',
    filePath: "test.js",
  });
  await t.throwsAsync(result, expectations, "prototype new Function(...)");

  // Check new GeneratorFunction()
  result = runner.run(globals, {
    code: 'new (Object.getPrototypeOf(function*(){}).constructor)("callback()")',
    filePath: "test.js",
  });
  await t.throwsAsync(result, expectations, "new GeneratorFunction(...)");
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
    { outsideObject: {}, outsideRegexp: /a/ },
    {
      code: `
      // Simulating wasm-bindgen
      export const outsideInstanceOf = outsideObject instanceof Object;
      export const insideInstanceOf = {} instanceof Object;
      
      export const outsideRegExpInstanceOf = outsideRegexp instanceof RegExp;
      export const insideRegExpInstanceOf = /a/ instanceof RegExp;
      
      // https://github.com/cloudflare/miniflare/issues/109
      // https://github.com/cloudflare/miniflare/issues/141
      export const outsideConstructor = outsideObject.constructor === Object;
      export const insideConstructor = {}.constructor === Object;

      // https://github.com/cloudflare/miniflare/issues/137
      export const newObject = new Object({ a: 1 });
      
      // https://github.com/cloudflare/wrangler2/issues/91
      export const outsidePrototype = Object.getPrototypeOf(outsideObject) === Object.prototype;
      export const insidePrototype = Object.getPrototypeOf({}) === Object.prototype;
      `,
      filePath: "test.js",
    },
    []
  );

  t.true(result.exports.outsideInstanceOf);
  t.true(result.exports.insideInstanceOf);

  t.true(result.exports.outsideRegExpInstanceOf);
  t.true(result.exports.insideRegExpInstanceOf);

  t.false(result.exports.outsideConstructor); // :(
  t.true(result.exports.insideConstructor);

  t.deepEqual(result.exports.newObject, { a: 1 });

  t.false(result.exports.outsidePrototype); // :(
  t.true(result.exports.insidePrototype);
});
