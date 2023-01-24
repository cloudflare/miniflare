import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { TextDecoder } from "util";
import { VMScriptRunner, VMScriptRunnerError } from "@miniflare/runner-vm";
import {
  Compatibility,
  Context,
  ModuleRule,
  ProcessedModuleRule,
  STRING_SCRIPT_PATH,
  ScriptRunnerResult,
  globsToMatcher,
} from "@miniflare/shared";
import test, { Macro } from "ava";

const fixturesPath = path.join(__dirname, "..", "..", "test", "fixtures");
// Path of fake linker test script, linked modules are resolved relative to this
const filePath = path.join(fixturesPath, "test.mjs");

const runner = new VMScriptRunner();

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
  include: globsToMatcher(rule.include),
}));

async function run(
  code: string,
  globalScope: Context = {},
  compat?: Compatibility
): Promise<ScriptRunnerResult> {
  return runner.run(
    globalScope,
    { code, filePath },
    processedModuleRules,
    undefined,
    compat
  );
}

test("ModuleLinker: links ESModule module via ES module", async (t) => {
  const result = await run(
    `import value from "./esmodule.mjs"; export default value;`
  );
  t.is(result.exports.default, "ESModule test");
});
test("ModuleLinker: links CommonJS module via ES module", async (t) => {
  const result = await run(
    `import value from "./cjs.cjs"; export default value;`
  );
  t.is(result.exports.default, "CommonJS test");
});
test("ModuleLinker: links Text module via ES module", async (t) => {
  const result = await run(
    `import value from "./text.txt"; export default value;`
  );
  t.is(result.exports.default.trimEnd(), "Text test");
});
test("ModuleLinker: links Data module via ES module", async (t) => {
  const result = await run(
    `import value from "./data.bin"; export default value;`
  );
  t.is(new TextDecoder().decode(result.exports.default).trimEnd(), "Data test");
});
test("ModuleLinker: links CompiledWasm module via ES module", async (t) => {
  const result = await run(
    // add.wasm is a WebAssembly module with a single export "add" that adds
    // its 2 integer parameters together and returns the result, it is from:
    // https://webassembly.github.io/wabt/demo/wat2wasm/
    `
    import addModule from "./add.wasm";
    const instance = new WebAssembly.Instance(addModule);
    export default instance.exports.add(1, 2);
    `
  );
  t.is(result.exports.default, 3);
});
test("ModuleLinker: links cyclic ES modules via ES module", async (t) => {
  const result = await run(
    `import { ping } from "./cyclic1.mjs"; export default ping;`
  );
  t.is(result.exports.default(), "pong");
});
test("ModuleLinker: builds set of linked module paths", async (t) => {
  const result = await run(`import value from "./recursive.mjs"`);
  t.deepEqual(result.watch, [
    path.join(fixturesPath, "recursive.mjs"),
    path.join(fixturesPath, "esmodule.mjs"),
  ]);
});
test("ModuleLinker: throws error if trying to import from string script", async (t) => {
  const result = runner.run(
    {},
    {
      code: `import value from "./esmodule.mjs"`,
      filePath: STRING_SCRIPT_PATH,
    },
    processedModuleRules
  );
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_STRING_SCRIPT",
    message: /imports unsupported with string script$/,
  });
});
test("ModuleLinker: throws error if no matching module rule via ES module", async (t) => {
  const result = run(`import image from "./image.jpg"`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_RULE",
    message: /no matching module rules.*\nIf you're trying to import an npm/,
  });
});
test("ModuleLinker: throws error for Node built-in module via ES module", async (t) => {
  const result = run(`import fs from "fs"`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_RULE",
    message:
      /no matching module rules.*\nIf you're trying to import a Node\.js built-in/,
  });
});
test("ModuleLinker: throws error for unsupported module type via ES module", async (t) => {
  const result = run(`import image from "./image.png"`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_UNSUPPORTED",
    message: /PNG modules are unsupported$/,
  });
});
test("ModuleLinker: links additional module via ES module", async (t) => {
  const callback = (defaultExport: string, namedExport: number) => {
    t.is(defaultExport, "test");
    t.is(namedExport, 42);
  };
  const additionalModules = { ADDITIONAL: { default: "test", n: 42 } };
  await runner.run(
    { callback },
    { code: 'import s, { n } from "ADDITIONAL"; callback(s, n);', filePath },
    processedModuleRules,
    additionalModules
  );
});

test("ModuleLinker: throws error when linking ESModule via CommonJS module", async (t) => {
  // Technically Workers "supports" this, in that it doesn't throw an error,
  // but it doesn't make any sense, so we disallow it
  const result = run(`import value from "./cjsesmodule.cjs"`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_CJS_MODULE_UNSUPPORTED",
    message: /CommonJS modules cannot require ES modules$/,
  });
});
test("ModuleLinker: links CommonJS module via CommonJS module", async (t) => {
  const result = await run(
    `import value from "./cjscjs.cjs"; export default value;`
  );
  t.is(result.exports.default, "CommonJS CommonJS test");
});
test("ModuleLinker: links Text module via CommonJS module", async (t) => {
  const result = await run(
    `import value from "./cjstext.cjs"; export default value;`
  );
  t.is(result.exports.default, "CommonJS Text test");
});
test("ModuleLinker: links Data module via CommonJS module", async (t) => {
  const result = await run(
    `import value from "./cjsdata.cjs"; export default value;`,
    { TextDecoder }
  );
  t.is(result.exports.default, "CommonJS Data test");
});
test("ModuleLinker: links CompiledWasm module via CommonJS module", async (t) => {
  const result = await run(
    `import value from "./cjscompiledwasm.cjs"; export default value;`
  );
  t.is(result.exports.default.add1(1), 2);
});
test("ModuleLinker: links cyclic CommonJS modules", async (t) => {
  const result = await run(
    `import value from "./cjscyclic1.cjs"; export default value;`
  );
  t.is(result.exports.default.ping(), "pong");
});
test("ModuleLinker: throws error if no matching module rule via CommonJS module", async (t) => {
  const result = run(`import value from "./cjsjpg.cjs"; export default value;`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_RULE",
    message: /no matching module rules.*\nIf you're trying to import an npm/,
  });
});
test("ModuleLinker: throws error for Node built-in module via CommonJS module", async (t) => {
  const result = run(
    `import value from "./cjsbuiltin.cjs"; export default value;`
  );
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_RULE",
    message:
      /no matching module rules.*\nIf you're trying to import a Node\.js built-in/,
  });
});
test("ModuleLinker: throws error for unsupported module type via CommonJS module", async (t) => {
  const result = run(`import value from "./cjspng.cjs"; export default value;`);
  await t.throwsAsync(result, {
    instanceOf: VMScriptRunnerError,
    code: "ERR_MODULE_UNSUPPORTED",
    message: /PNG modules are unsupported$/,
  });
});
test("ModuleLinker: stack trace references correct line for CommonJS modules", async (t) => {
  const result = await run(
    `import value from "./cjserror.cjs"; export default value;`
  );
  try {
    result.exports.default();
    t.fail();
  } catch (e: any) {
    // Error is thrown on line 2 of file
    t.regex(e.stack, /cjserror\.cjs:2:9/);
  }
});
test("ModuleLinker: links additional module via CommonJS module", async (t) => {
  const callback = (defaultExport: string) => {
    t.is(defaultExport, "CommonJS test");
  };
  const additionalModules = { ADDITIONAL: { default: "test" } };
  await runner.run(
    { callback },
    { code: 'import s from "./cjsadditional.cjs"; callback(s);', filePath },
    processedModuleRules,
    additionalModules
  );
});

const sizePath = path.join(fixturesPath, "size");
const sizeEntryPath = path.join(sizePath, "entry.mjs");
const sizeEntryReferencedPath = path.join(sizePath, "entryreferenced.mjs");
const sizeSharedPath = path.join(sizePath, "shared.mjs");
const sizeEntryDiamondPath = path.join(sizePath, "entrydiamond.mjs");
const sizeAPath = path.join(sizePath, "a.mjs");
const sizeBPath = path.join(sizePath, "b.mjs");

const fileSize = (p: string) => readFileSync(p).byteLength;
const sizeEntry = fileSize(sizeEntryPath);
const sizeEntryReferenced = fileSize(sizeEntryReferencedPath);
const sizeShared = fileSize(sizeSharedPath);
const sizeEntryDiamond = fileSize(sizeEntryDiamondPath);
const sizeA = fileSize(sizeAPath);
const sizeB = fileSize(sizeBPath);

const bundleSizeMacro: Macro<[entryFilePath: string, expectedSize: number]> =
  async (t, entryFilePath, expectedSize) => {
    const result = await runner.run(
      {},
      {
        code: await fs.readFile(entryFilePath, "utf8"),
        filePath: entryFilePath,
      },
      processedModuleRules
    );
    t.is(result.bundleSize, expectedSize);
  };
bundleSizeMacro.title = (providedTitle) =>
  `ModuleLinker: bundle size includes ${providedTitle}`;
test("script", bundleSizeMacro, sizeEntryPath, sizeEntry);
test(
  "referenced modules",
  bundleSizeMacro,
  sizeEntryReferencedPath,
  sizeEntryReferenced + sizeShared
);
test(
  "module in total at most once",
  bundleSizeMacro,
  sizeEntryDiamondPath,
  sizeEntryDiamond + sizeA + sizeB + sizeShared
);

test("ModuleLinker: permits dynamic import in entrypoint", async (t) => {
  const result = await run(
    `
    export default async function() {
      return (await import("./esmodule.mjs")).default;
    }
    `
  );
  t.is(await result.exports.default(), "ESModule test");
});
test("ModuleLinker: permits dynamic import in ES module", async (t) => {
  const result = await run(`import f from "./dynamic.mjs"; export default f;`);
  t.is((await result.exports.default()).trimEnd(), "Text test");
});
test("ModuleLinker: permits dynamic import of statically linked module", async (t) => {
  const result = await run(
    `
    import staticValue from "./esmodule.mjs";
    export default async function() {
      const module = await import("./esmodule.mjs");
      return { static: staticValue, dynamic: module.default };
    }
    `
  );
  t.deepEqual(await result.exports.default(), {
    static: "ESModule test",
    dynamic: "ESModule test",
  });
});

test("ModuleLinker: respects export_commonjs_namespace compatibility flag", async (t) => {
  let compat = new Compatibility(undefined, ["export_commonjs_default"]);
  let result = await run(
    `
    import ns from "./cjsnamespace.cjs";
    export default function() {
      return ns;
    }  
    `,
    undefined,
    compat
  );
  let exports = await result.exports.default()();
  t.is(exports.cjs, "CommonJS test");
  t.is(exports.txt.trimEnd(), "Text test");
  t.is(exports.txt, exports.txt2);

  compat = new Compatibility(undefined, ["export_commonjs_namespace"]);
  result = await run(
    `
    import ns from "./cjsnamespace.cjs";
    export default function() {
      return ns;
    }  
    `,
    undefined,
    compat
  );
  exports = await result.exports.default()();
  t.is(exports.cjs.default, "CommonJS test");
  t.is(exports.txt.default.trimEnd(), "Text test");
  t.is(exports.txt, exports.txt2);
});
