import assert from "assert";
import { existsSync, promises as fs } from "fs";
import path from "path";
import { URL } from "url";
import test from "ava";
import { NoOpLog, Options } from "../../src";
import { OptionsError, stringScriptPath } from "../../src/options";
import { OptionsProcessor } from "../../src/options/processor";
import { TestLog, useTmp } from "../helpers";

const fixturesPath = path.resolve(__dirname, "..", "fixtures");
const durableObjectScriptPath = path.join(fixturesPath, "do.js");
const durableObject2ScriptPath = path.join(fixturesPath, "do2.js");
const wasmModulePath = path.join(fixturesPath, "modules", "add.wasm");

test("addScriptBlueprint: loads script from file", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "test.js");
  await fs.writeFile(scriptPath, `// test`);
  const processor = new OptionsProcessor(new NoOpLog(), {});
  await processor.addScriptBlueprint(scriptPath);
  const { code, fileName } = processor._scriptBlueprints[scriptPath];
  t.is(code, "// test");
  t.is(fileName, scriptPath);
});
test("addScriptBlueprint: loads script from string", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {
    script: "// test",
  });
  await processor.addScriptBlueprint(stringScriptPath);
  const { code, fileName } = processor._scriptBlueprints[stringScriptPath];
  t.is(code, "// test");
  t.is(fileName, stringScriptPath);
});
test("addScriptBlueprint: logs error if script cannot be found", async (t) => {
  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "test.js");
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  await processor.addScriptBlueprint(scriptPath);
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /Error: ENOENT/);
});

test("resetScriptBlueprints: resets script blueprints", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {
    script: "// test",
  });
  t.is(Object.keys(processor._scriptBlueprints).length, 0);
  await processor.addScriptBlueprint(stringScriptPath);
  t.is(Object.keys(processor._scriptBlueprints).length, 1);
  processor.resetScriptBlueprints();
  t.is(Object.keys(processor._scriptBlueprints).length, 0);
});

test("runCustomBuild: runs build successfully", async (t) => {
  const tmp = await useTmp(t);
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  await processor.runCustomBuild("echo test > test.txt", tmp);
  t.deepEqual(log.infos, ["Build succeeded"]);
  const test = await fs.readFile(path.join(tmp, "test.txt"), "utf8");
  t.is(test.trim(), "test");
});
test("runCustomBuild: runs one build at a time", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const start = process.hrtime();
  // Cross-platform wait for at least 600ms
  const waitCommand = `node -e "setTimeout(() => {}, 600)"`;
  await Promise.all([
    processor.runCustomBuild(waitCommand),
    processor.runCustomBuild(waitCommand),
  ]);
  const end = process.hrtime(start);
  // Check waited for at least 1 second
  t.true(end[0] >= 1);
});
test("runCustomBuild: logs exit code if build fails", async (t) => {
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  await processor.runCustomBuild("exit 1");
  t.deepEqual(log.errors, ["Build failed with exit code 1"]);
});

test("getWranglerOptions: loads wrangler configuration from wrangler.toml by default", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  t.is(processor.wranglerConfigPath, path.resolve("wrangler.toml"));
});
test("getWranglerOptions: loads wrangler configuration from custom file", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(wranglerConfigPath, `vars = { KEY = "value" }`, "utf8");
  const processor = new OptionsProcessor(new NoOpLog(), { wranglerConfigPath });
  t.is(processor.wranglerConfigPath, wranglerConfigPath);
  const options = await processor.getWranglerOptions();
  t.deepEqual(options.bindings, { KEY: "value" });
});
test("getWranglerOptions: loads correct environment's wrangler configuration", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    `[miniflare]\nkv_persist = true\n[env.production.miniflare]\nkv_persist = "prod"`,
    "utf8"
  );
  const processor = new OptionsProcessor(new NoOpLog(), {
    wranglerConfigPath,
    wranglerConfigEnv: "production",
  });
  const options = await processor.getWranglerOptions();
  t.is(options.kvPersist, "prod");
});
test("getWranglerOptions: logs error if cannot read configuration from custom file only", async (t) => {
  const log = new TestLog();
  let processor = new OptionsProcessor(log, {});
  await processor.getWranglerOptions();
  t.deepEqual(log.errors, []);

  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  processor = new OptionsProcessor(log, { wranglerConfigPath });
  const options = await processor.getWranglerOptions();
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /Error: ENOENT/);
  t.deepEqual(
    Object.values(options).filter((value) => value),
    []
  );
});
test("getWranglerOptions: logs error if cannot parse configuration", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(wranglerConfigPath, `vars = {`, "utf8");
  const processor = new OptionsProcessor(log, { wranglerConfigPath });
  await processor.getWranglerOptions();
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /^Unable to parse/);
});

test("getScriptPath: throws if no script defined", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  t.throws(() => processor.getScriptPath({}), {
    instanceOf: OptionsError,
    message: /^No script defined/,
  });
});
test("getScriptPath: resolves non-string-script paths", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  t.is(
    processor.getScriptPath({ scriptPath: "test.js" }),
    path.resolve("test.js")
  );
  t.is(
    processor.getScriptPath({ scriptPath: stringScriptPath }),
    stringScriptPath
  );
});

test("getProcessedDurableObjects: processes durable objects defined as strings", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const scriptPath = path.resolve("default.js");
  const objects = processor.getProcessedDurableObjects({
    scriptPath,
    durableObjects: { OBJECT: "Object" },
  });
  t.deepEqual(objects, [{ name: "OBJECT", className: "Object", scriptPath }]);
});
test("getProcessedDurableObjects: processes durable objects defined as objects", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const scriptPath = path.resolve("default.js");
  const objects = processor.getProcessedDurableObjects({
    scriptPath,
    durableObjects: { OBJECT: { className: "Object" } },
  });
  t.deepEqual(objects, [{ name: "OBJECT", className: "Object", scriptPath }]);
});
test("getProcessedDurableObjects: processes durable objects with custom script paths", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const scriptPath = path.resolve("default.js");
  const objects = processor.getProcessedDurableObjects({
    scriptPath,
    durableObjects: {
      OBJECT: { className: "Object", scriptPath: "custom.js" },
    },
  });
  t.deepEqual(objects, [
    {
      name: "OBJECT",
      className: "Object",
      scriptPath: path.resolve("custom.js"),
    },
  ]);
});
test("getProcessedDurableObjects: defaults to empty array", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const scriptPath = path.resolve("default.js");
  const objects = processor.getProcessedDurableObjects({ scriptPath });
  t.deepEqual(objects, []);
});

test("getProcessedModulesRules: processes module rules, including default module rules", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const rules = processor.getProcessedModulesRules({
    modulesRules: [
      { type: "Text", include: ["**/*.txt"], fallthrough: true },
      { type: "Text", include: ["**/*.text"], fallthrough: true },
    ],
  });
  t.is(rules.length, 4);
  t.is(rules[0].type, "Text");
  t.true(rules[0].include.some((r) => r.test("test.txt")));
  t.is(rules[1].type, "Text");
  t.true(rules[1].include.some((r) => r.test("test.text")));
  t.is(rules[2].type, "ESModule");
  t.true(rules[2].include.some((r) => r.test("test.mjs")));
  t.is(rules[3].type, "CommonJS");
  t.true(rules[3].include.some((r) => r.test("test.js")));
  t.true(rules[3].include.some((r) => r.test("test.cjs")));
});
test("getProcessedModulesRules: ignores rules with same type if no fallthrough", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const rules = processor.getProcessedModulesRules({
    modulesRules: [{ type: "CommonJS", include: ["**/*.js"] }],
  });
  t.is(rules.length, 2);
  t.is(rules[0].type, "CommonJS");
  t.true(rules[0].include.some((r) => r.test("test.js")));
  t.is(rules[1].type, "ESModule");
  t.true(rules[1].include.some((r) => r.test("test.mjs")));
});
test("getProcessedModulesRules: defaults to default module rules", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const rules = processor.getProcessedModulesRules({});
  t.is(rules.length, 2);
  t.is(rules[0].type, "ESModule");
  t.true(rules[0].include.some((r) => r.test("test.mjs")));
  t.is(rules[1].type, "CommonJS");
  t.true(rules[1].include.some((r) => r.test("test.js")));
  t.true(rules[1].include.some((r) => r.test("test.cjs")));
});

test("getEnvBindings: loads env from .env by default", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const { envPath } = await processor.getEnvBindings({});
  t.is(envPath, path.resolve(".env"));
});
test("getEnvBindings: loads env from custom file", async (t) => {
  const tmp = await useTmp(t);
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, `KEY=value`, "utf8");
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const {
    envPath: resolvedEnvPath,
    envBindings,
  } = await processor.getEnvBindings({ envPath });
  t.is(resolvedEnvPath, envPath);
  t.deepEqual(envBindings, { KEY: "value" });
});
test("getEnvBindings: logs error if cannot read env from custom file only", async (t) => {
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  await processor.getEnvBindings({});
  t.deepEqual(log.errors, []);

  const tmp = await useTmp(t);
  const envPath = path.join(tmp, ".env");
  const { envBindings } = await processor.getEnvBindings({ envPath });
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /Error: ENOENT/);
  t.deepEqual(envBindings, {});
});

test("getWasmBindings: loads wasm bindings", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const bindings = await processor.getWasmBindings({
    wasmBindings: { ADD_MODULE: wasmModulePath },
  });
  const instance = new WebAssembly.Instance(bindings.ADD_MODULE);
  // @ts-expect-error add is exported by add.wasm
  t.is(instance.exports.add(1, 2), 3);
});
test("getWasmBindings: logs error if cannot load wasm binding", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const processor = new OptionsProcessor(log, {});
  const bindings = await processor.getWasmBindings({
    wasmBindings: { MODULE: path.join(tmp, "module.wasm") },
  });
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /Error: ENOENT/);
  t.deepEqual(bindings, {});
});
test("getWasmBindings: defaults to empty object", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const bindings = await processor.getWasmBindings({});
  t.deepEqual(bindings, {});
});

test("getUpstreamUrl: parses upstream url", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const url = processor.getUpstreamUrl({ upstream: "https://mrbbot.dev" });
  t.deepEqual(url, new URL("https://mrbbot.dev"));
});
test("getUpstreamUrl: logs error if cannot parse upstream url", (t) => {
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  const url = processor.getUpstreamUrl({ upstream: "bad url" });
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /^Unable to parse upstream/);
  t.is(url, undefined);
});
test("getUpstreamUrl: defaults to undefined upstream url", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const url = processor.getUpstreamUrl({});
  t.is(url, undefined);
});

test("getValidatedCrons: parses crons", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const validatedCrons = processor.getValidatedCrons({ crons: ["30 * * * *"] });
  t.deepEqual(validatedCrons, ["30 * * * *"]);
});
test("getValidatedCrons: logs error if cannot parse cron", (t) => {
  const log = new TestLog();
  const processor = new OptionsProcessor(log, {});
  const validatedCrons = processor.getValidatedCrons({
    crons: ["bad", "* * * * *"],
  });
  t.is(log.errors.length, 1);
  t.regex(log.errors[0], /^Unable to parse cron "bad"/);
  t.deepEqual(validatedCrons, ["* * * * *"]);
});
test("getValidatedCrons: defaults to empty array", (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {});
  const validatedCrons = processor.getValidatedCrons({});
  t.deepEqual(validatedCrons, []);
});

test("getProcessedOptions: includes all processed options", async (t) => {
  const tmp = await useTmp(t);

  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    `vars = { WRANGLER_KEY = "wrangler_value" }`,
    "utf8"
  );

  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, `ENV_KEY=env_value`, "utf8");

  const options: Options = {
    script: "// test",
    wranglerConfigPath,
    modules: true,
    modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
    upstream: "https://mrbbot.dev",
    crons: ["* * * * *"],
    siteInclude: ["**/*.html"],
    siteExclude: ["**/*.png"],
    durableObjects: {
      OBJECT2: { className: "Object2", scriptPath: durableObject2ScriptPath },
    },
    envPath,
    bindings: { OPTIONS_KEY: "options_value" },
    wasmBindings: { ADD_MODULE: wasmModulePath },
  };
  const processor = new OptionsProcessor(new NoOpLog(), options);
  const processedOptions = await processor.getProcessedOptions();

  // Check scripts processed
  t.is(processedOptions.scriptPath, stringScriptPath);
  t.not(processedOptions.scripts, undefined);
  assert(processedOptions.scripts);
  t.is(processedOptions.scripts[stringScriptPath].code, "// test");
  t.deepEqual(processedOptions.processedDurableObjects, [
    {
      name: "OBJECT2",
      className: "Object2",
      scriptPath: durableObject2ScriptPath,
    },
  ]);
  t.regex(
    processedOptions.scripts[durableObject2ScriptPath].code,
    /export class Object2/
  );

  // Check module rules processed
  const rules = processedOptions.processedModulesRules;
  t.not(rules, undefined);
  assert(rules);
  t.is(rules.length, 3);
  t.is(rules[0].type, "Text");
  t.true(rules[0].include.some((r) => r.test("test.txt")));
  t.is(rules[1].type, "ESModule");
  t.true(rules[1].include.some((r) => r.test("test.mjs")));
  t.is(rules[2].type, "CommonJS");
  t.true(rules[2].include.some((r) => r.test("test.js")));
  t.true(rules[2].include.some((r) => r.test("test.cjs")));

  // Check .env bindings loaded
  t.not(processedOptions.bindings, undefined);
  assert(processedOptions.bindings);
  t.is(processedOptions.bindings.ENV_KEY, "env_value");

  // Check wasm bindings loaded
  const instance = new WebAssembly.Instance(
    processedOptions.bindings.ADD_MODULE
  );
  // @ts-expect-error add is exported by add.wasm
  t.is(instance.exports.add(1, 2), 3);

  // Check upstream url
  t.deepEqual(processedOptions.upstreamUrl, new URL("https://mrbbot.dev"));

  // Check validated crons
  t.deepEqual(processedOptions.validatedCrons, ["* * * * *"]);

  // Check site include/exclude regexps
  t.true(processedOptions.siteIncludeRegexps?.some((r) => r.test("test.html")));
  t.true(processedOptions.siteExcludeRegexps?.some((r) => r.test("test.png")));
});
test("getProcessedOptions: overrides wrangler configuration with initial options", async (t) => {
  const tmp = await useTmp(t);
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    "[miniflare]\nkv_persist = true\ncache_persist = true",
    "utf8"
  );

  const processor = new OptionsProcessor(new NoOpLog(), {
    script: "// test",
    wranglerConfigPath,
    kvPersist: "data",
  });
  const options = await processor.getProcessedOptions();
  t.is(options.kvPersist, "data"); // Overridden
  t.is(options.cachePersist, true); // Not overridden
});
test("getProcessedOptions: runs build on initial options get only", async (t) => {
  const log = new TestLog();
  const tmp = await useTmp(t);
  const processor = new OptionsProcessor(log, {
    script: "// test",
    buildCommand: "echo test > test.txt",
    buildBasePath: tmp,
  });

  await processor.getProcessedOptions();
  t.deepEqual(log.infos, []);
  t.false(existsSync(path.join(tmp, "test.txt")));

  await processor.getProcessedOptions(true);
  t.deepEqual(log.infos, ["Build succeeded"]);
  const test = await fs.readFile(path.join(tmp, "test.txt"), "utf8");
  t.is(test.trim(), "test");
});
test("getProcessedOptions: loads scripts for entrypoint and durable objects", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {
    scriptPath: durableObjectScriptPath,
    durableObjects: {
      OBJECT2: { className: "Object2", scriptPath: durableObject2ScriptPath },
    },
  });
  const options = await processor.getProcessedOptions();
  const scripts = options.scripts;
  t.not(scripts, undefined);
  assert(scripts);
  t.regex(scripts[durableObjectScriptPath].code, /export class Object1/);
  t.regex(scripts[durableObject2ScriptPath].code, /export class Object2/);
});
test("getProcessedOptions: loads script from string", async (t) => {
  const processor = new OptionsProcessor(new NoOpLog(), {
    script: "// test",
  });
  const options = await processor.getProcessedOptions();
  const scripts = options.scripts;
  t.not(scripts, undefined);
  assert(scripts);
  t.is(scripts[stringScriptPath].code, "// test");
});
test("getProcessedOptions: prioritises initial option's bindings, then wasm, then env, then wrangler configuration's", async (t) => {
  const tmp = await useTmp(t);

  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  await fs.writeFile(
    wranglerConfigPath,
    `vars = { KEY1 = "wrangler1", KEY2 = "wrangler2", KEY3 = "wrangler3", KEY4 = "wrangler4" }`,
    "utf8"
  );

  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, `KEY1=env1\nKEY2=env2\nKEY3=env3`, "utf8");

  const processor = new OptionsProcessor(new NoOpLog(), {
    script: "// test",
    bindings: { KEY1: "initial1" },
    wasmBindings: {
      KEY1: wasmModulePath,
      KEY2: wasmModulePath,
    },
    wranglerConfigPath,
    envPath,
  });

  const { bindings } = await processor.getProcessedOptions();
  t.not(bindings, undefined);
  assert(bindings);
  t.is(bindings.KEY1, "initial1");
  t.true(bindings.KEY2 instanceof WebAssembly.Module);
  t.is(bindings.KEY3, "env3");
  t.is(bindings.KEY4, "wrangler4");
});
