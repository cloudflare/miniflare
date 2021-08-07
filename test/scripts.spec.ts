import path from "path";
import { TextDecoder } from "util";
import test from "ava";
import picomatch from "picomatch";
import { MiniflareError } from "../src";
import {
  ModuleRule,
  ProcessedModuleRule,
  stringScriptPath,
} from "../src/options";
import {
  ScriptBlueprint,
  ScriptLinker,
  createScriptContext,
} from "../src/scripts";

const matchOptions: picomatch.PicomatchOptions = { contains: true };
const moduleRules: ModuleRule[] = [
  { type: "ESModule", include: ["**/*.mjs"] },
  { type: "CommonJS", include: ["**/*.js", "**/*.cjs"] },
  { type: "Text", include: ["**/*.txt"] },
  { type: "Data", include: ["**/*.bin"] },
  { type: "CompiledWasm", include: ["**/*.wasm"] },
  // @ts-expect-error intentionally testing unsupported module types
  { type: "PNG", include: ["**/*.png"] },
];
const processedModuleRules = moduleRules.map<ProcessedModuleRule>((rule) => ({
  type: rule.type,
  include: rule.include.map((glob) => picomatch.makeRe(glob, matchOptions)),
}));

test("buildScript: runs code in sandbox", async (t) => {
  t.plan(1);
  const blueprint = new ScriptBlueprint(`callback("test")`, "test.js");
  const context = createScriptContext({
    callback: (result: string) => t.is(result, "test"),
  });
  const script = await blueprint.buildScript(context);
  await script.run();
});
test("buildScript: disallows code generation", async (t) => {
  const blueprint = new ScriptBlueprint(`eval('callback()')`, "test.js");
  const context = createScriptContext({ callback: () => t.fail() });
  const script = await blueprint.buildScript(context);
  await t.throwsAsync(script.run(), {
    message: "Code generation from strings disallowed for this context",
  });
});
test("buildScript: includes file name in stack traces", async (t) => {
  const blueprint = new ScriptBlueprint(`throw new Error("test")`, "test.js");
  const script = await blueprint.buildScript(createScriptContext({}));
  try {
    await script.run();
    t.fail();
  } catch (e) {
    t.true(e.stack.includes("at test.js:1"));
  }
});

test("buildModule: runs code in sandbox", async (t) => {
  t.plan(1);
  const blueprint = new ScriptBlueprint(`callback("test")`, "test.mjs");
  const { linker } = new ScriptLinker(processedModuleRules);
  const context = createScriptContext({
    callback: (result: string) => t.is(result, "test"),
  });
  const script = await blueprint.buildModule(context, linker);
  await script.run();
});
test("buildModule: disallows code generation", async (t) => {
  const blueprint = new ScriptBlueprint(`eval('callback()')`, "test.mjs");
  const { linker } = new ScriptLinker(processedModuleRules);
  const context = createScriptContext({ callback: () => t.fail() });
  const script = await blueprint.buildModule(context, linker);
  await t.throwsAsync(script.run(), {
    message: "Code generation from strings disallowed for this context",
  });
});
test("buildModule: includes file name in stack traces", async (t) => {
  const blueprint = new ScriptBlueprint(`throw new Error("test")`, "test.mjs");
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  try {
    await script.run();
    t.fail();
  } catch (e) {
    t.true(e.stack.includes("at test.mjs:1"));
  }
});
test("buildModule: exposes exports", async (t) => {
  const blueprint = new ScriptBlueprint(
    `export const a = "a"; export default "b";`,
    "test.mjs"
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.is(script.exports.a, "a");
  t.is(script.exports.default, "b");
});

// Path of fake linker test script, linked modules are resolved relative to this
const linkerScriptPath = path.resolve(
  __dirname,
  "fixtures",
  "modules",
  "test.mjs"
);

test("buildLinker: links ESModule modules", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./esmodule.mjs"; export default value;`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.is(script.exports.default, "ESModule test");
});
test("buildLinker: links CommonJS modules", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./commonjs.cjs"; export default value;`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.is(script.exports.default, "CommonJS test");
});
test("buildLinker: links Text modules", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./text.txt"; export default value;`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.is(script.exports.default.trimEnd(), "Text test");
});
test("buildLinker: links Data modules", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./data.bin"; export default value;`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.deepEqual(
    new TextDecoder().decode(script.exports.default).trimEnd(),
    "Data test"
  );
});
test("buildLinker: links CompiledWasm modules", async (t) => {
  const blueprint = new ScriptBlueprint(
    // add.wasm is a WebAssembly module with a single export "add" that adds
    // its 2 integer parameters together and returns the result, it is from:
    // https://webassembly.github.io/wabt/demo/wat2wasm/
    `
    import addModule from "./add.wasm";
    const instance = new WebAssembly.Instance(addModule);
    export default instance.exports.add(1, 2);
    `,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  const script = await blueprint.buildModule(createScriptContext({}), linker);
  await script.run();
  t.is(script.exports.default, 3);
});
test("buildLinker: builds set of linked module paths", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./recursive.mjs"`,
    linkerScriptPath
  );
  const { linker, referencedPaths } = new ScriptLinker(processedModuleRules);
  await blueprint.buildModule(createScriptContext({}), linker);
  const dir = path.dirname(linkerScriptPath);
  t.deepEqual(
    referencedPaths,
    new Set([path.join(dir, "recursive.mjs"), path.join(dir, "esmodule.mjs")])
  );
});
test("buildLinker: throws error if trying to import from string script", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import value from "./esmodule.mjs"`,
    stringScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  await t.throwsAsync(blueprint.buildModule(createScriptContext({}), linker), {
    instanceOf: MiniflareError,
    message: /imports unsupported with string script$/,
  });
});
test("buildLinker: throws error if no matching module rule", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import image from "./image.jpg"`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  await t.throwsAsync(blueprint.buildModule(createScriptContext({}), linker), {
    instanceOf: MiniflareError,
    message: /no matching module rules$/,
  });
});
test("buildLinker: throws error for unsupported module type", async (t) => {
  const blueprint = new ScriptBlueprint(
    `import image from "./image.png"`,
    linkerScriptPath
  );
  const { linker } = new ScriptLinker(processedModuleRules);
  await t.throwsAsync(blueprint.buildModule(createScriptContext({}), linker), {
    instanceOf: MiniflareError,
    message: /PNG modules are unsupported$/,
  });
});
