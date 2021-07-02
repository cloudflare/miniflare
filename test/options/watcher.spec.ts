import { promises as fs } from "fs";
import os from "os";
import path from "path";
import anyTest, { Macro, TestInterface } from "ava";
import { Options, ProcessedOptions, stringScriptPath } from "../../src/options";
import {
  OptionsWatchCallback,
  OptionsWatcher,
} from "../../src/options/watcher";
import { TestLog, useTmp, wait } from "../helpers";

// TODO: (low priority) investigate why watcher tests are failing,
//  they only pass if they're executed on their own,
//  running in serial doesn't help

interface Context {
  callback: OptionsWatchCallback;
  next: () => Promise<ProcessedOptions>;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const optionsQueue: ProcessedOptions[] = [];
  const callback = (options: ProcessedOptions) => {
    optionsQueue.push(options);
  };

  // Poll optionsQueue for new options every 50ms
  const next = async () => {
    while (true) {
      const options = optionsQueue.shift();
      if (options) return options;
      await wait(50);
    }
  };

  t.context = { callback, next };
});

test.skip("constructor: loads initial options", async (t) => {
  const { callback, next } = t.context;
  const log = new TestLog();
  new OptionsWatcher(log, callback, { script: "// test" });

  const options = await next();
  t.deepEqual(log.debugs, ["Options:", "- Scripts: <script>"]);
  t.is(options.scripts?.[stringScriptPath].code, "// test");
});

const changeMacro: Macro<
  [
    {
      reloading: "scripts" | "options";
      fileName: string;
      originalContents?: string;
      newContents?: string;
      initialOptions: (filePath: string) => Options;
      extractValue: (options: ProcessedOptions, filePath: string) => any;
      originalValue: any;
      newValue: any;
    }
  ],
  Context
> = async (
  t,
  {
    reloading,
    fileName,
    originalContents,
    newContents,
    initialOptions,
    extractValue,
    originalValue,
    newValue,
  }
) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const filePath = path.join(tmp, fileName);
  const relativeFilePath = path.relative("", filePath);

  if (originalContents) await fs.writeFile(filePath, originalContents, "utf8");

  const watcher = new OptionsWatcher(log, callback, {
    watch: true,
    ...initialOptions(filePath),
  });
  t.teardown(() => watcher.dispose());

  let options = await next();
  t.is(extractValue(options, filePath), originalValue);

  log.debugs = [];
  if (newContents) {
    await fs.writeFile(filePath, newContents, "utf8");
  } else {
    await fs.unlink(filePath);
  }
  options = await next();
  t.is(log.debugs[0], `${relativeFilePath} changed, reloading ${reloading}...`);
  t.is(extractValue(options, filePath), newValue);
};

test.skip("reloads options on wrangler configuration change", changeMacro, {
  reloading: "options",
  fileName: "wrangler.toml",
  originalContents: "[miniflare]\nkv_persist = true",
  newContents: `[miniflare]\nkv_persist = "./data"`,
  initialOptions: (wranglerConfigPath) => ({
    script: "// test",
    wranglerConfigPath,
  }),
  extractValue: (options) => options.kvPersist,
  originalValue: true,
  newValue: "./data",
});
test.skip("reloads options on wrangler configuration create", changeMacro, {
  reloading: "options",
  fileName: "wrangler.toml",
  newContents: `[miniflare]\nkv_persist = "./data"`,
  initialOptions: (wranglerConfigPath) => ({
    script: "// test",
    wranglerConfigPath,
  }),
  extractValue: (options) => options.kvPersist,
  originalValue: undefined,
  newValue: "./data",
});
test.skip("reloads options on wrangler configuration delete", changeMacro, {
  reloading: "options",
  fileName: "wrangler.toml",
  originalContents: "[miniflare]\nkv_persist = true",
  initialOptions: (wranglerConfigPath) => ({
    script: "// test",
    wranglerConfigPath,
  }),
  extractValue: (options) => options.kvPersist,
  originalValue: true,
  newValue: undefined,
});

test.skip("reloads options on env change", changeMacro, {
  reloading: "options",
  fileName: ".env",
  originalContents: "KEY=value1",
  newContents: "KEY=value2",
  initialOptions: (envPath) => ({
    script: "// test",
    envPath,
  }),
  extractValue: (options) => options.bindings?.KEY,
  originalValue: "value1",
  newValue: "value2",
});
test.skip("reloads options on env create", changeMacro, {
  reloading: "options",
  fileName: ".env",
  newContents: "KEY=value",
  initialOptions: (envPath) => ({
    script: "// test",
    envPath,
  }),
  extractValue: (options) => options.bindings?.KEY,
  originalValue: undefined,
  newValue: "value",
});
test.skip("reloads options on env delete", changeMacro, {
  reloading: "options",
  fileName: ".env",
  originalContents: "KEY=value",
  initialOptions: (envPath) => ({
    script: "// test",
    envPath,
  }),
  extractValue: (options) => options.bindings?.KEY,
  originalValue: "value",
  newValue: undefined,
});

test.skip("reloads scripts on script change", changeMacro, {
  reloading: "scripts",
  fileName: "test.js",
  originalContents: "// test 1",
  newContents: "// test 2",
  initialOptions: (scriptPath) => ({ scriptPath }),
  extractValue: (options, scriptPath) => options.scripts?.[scriptPath].code,
  originalValue: "// test 1",
  newValue: "// test 2",
});
test.skip("reloads scripts on script create", changeMacro, {
  reloading: "scripts",
  // Test with Durable Object script file instead, as missing script would
  // throw exception
  fileName: "object.js",
  newContents: "// object",
  initialOptions: (scriptPath) => ({
    script: "// test",
    durableObjects: { OBJECT: { className: "Object", scriptPath } },
  }),
  extractValue: (options, scriptPath) => options.scripts?.[scriptPath]?.code,
  originalValue: "", // Scripts default to empty strings
  newValue: "// object",
});
test.skip("reloads scripts on script delete", changeMacro, {
  reloading: "scripts",
  // Test with Durable Object script file instead, as missing script would
  // throw exception
  fileName: "object.js",
  originalContents: "// object",
  initialOptions: (scriptPath) => ({
    script: "// test",
    durableObjects: { OBJECT: { className: "Object", scriptPath } },
  }),
  extractValue: (options, scriptPath) => options.scripts?.[scriptPath]?.code,
  originalValue: "// object",
  newValue: "", // Scripts default to empty strings
});

test.skip("rebuilds if watched build path changes", async (t) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const watchedPath = path.join(tmp, "watch.txt");
  const scriptPath = path.join(tmp, "script.js");
  const relativeWatchedPath = path.relative("", watchedPath);
  const relativeScriptPath = path.relative("", scriptPath);
  await fs.writeFile(watchedPath, "1", "utf8");

  const watcher = new OptionsWatcher(log, callback, {
    watch: true,
    scriptPath: scriptPath,
    buildCommand: `echo "// build" >> script.js`, // Append "build" to builds.txt
    buildBasePath: tmp,
    buildWatchPath: watchedPath,
  });
  t.teardown(() => watcher.dispose());

  let options = await next();
  t.is(options.scripts?.[scriptPath].code.trim(), "// build");

  // Trigger rebuild, this should modify the script which will yield new options
  log.debugs = [];
  await fs.writeFile(watchedPath, "2", "utf8");
  options = await next();
  t.is(log.debugs[0], `${relativeWatchedPath} changed, rebuilding...`);
  t.is(log.debugs[1], `${relativeScriptPath} changed, reloading scripts...`);
  t.is(options.scripts?.[scriptPath].code.trim(), `// build${os.EOL}// build`);
});

test.skip("setExtraWatchedPaths: watches extra paths", async (t) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const extraPath = path.join(tmp, "extra.txt");
  const relativeExtraPath = path.relative("", extraPath);
  await fs.writeFile(relativeExtraPath, "1", "utf8");

  const watcher = new OptionsWatcher(log, callback, {
    watch: true,
    script: "// test",
  });
  t.teardown(() => watcher.dispose());
  await next();

  // Update watched paths
  log.debugs = [];
  watcher.setExtraWatchedPaths(new Set([extraPath]));
  t.is(log.debugs[0], `Watching ${relativeExtraPath}...`);

  // Update extra watched path
  log.debugs = [];
  await fs.writeFile(extraPath, "2", "utf8");
  await next();
  t.is(log.debugs[0], `${relativeExtraPath} changed, reloading scripts...`);

  // Remove watched paths
  log.debugs = [];
  watcher.setExtraWatchedPaths(new Set());
  t.is(log.debugs[0], `Unwatching ${relativeExtraPath}...`);
});

const switchMacro: Macro<
  [
    {
      reloading: "scripts" | "options";
      fileNamePrefix: string;
      contents: (i: number) => string;
      wranglerConfigContents: (watchedFile: string) => string;
      initialOptions?: Options;
    }
  ],
  Context
> = async (
  t,
  {
    reloading,
    fileNamePrefix,
    contents,
    wranglerConfigContents,
    initialOptions,
  }
) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const filePath1 = path.join(tmp, fileNamePrefix + "1");
  const filePath2 = path.join(tmp, fileNamePrefix + "2");
  const wranglerConfigPath = path.join(tmp, "wrangler.toml");
  const relativeFilePath1 = path.relative("", filePath1);
  const relativeFilePath2 = path.relative("", filePath2);
  const relativeWranglerConfigPath = path.relative("", wranglerConfigPath);
  await fs.writeFile(filePath1, contents(1), "utf8");
  await fs.writeFile(filePath2, contents(2), "utf8");
  await fs.writeFile(
    wranglerConfigPath,
    wranglerConfigContents(filePath1),
    "utf8"
  );

  const watcher = new OptionsWatcher(log, callback, {
    watch: true,
    ...initialOptions,
    wranglerConfigPath,
  });
  t.teardown(() => watcher.dispose());
  await next();

  // Update filePath2, shouldn't trigger change yet
  log.debugs = [];
  await fs.writeFile(filePath2, contents(3), "utf8");
  // Update filePath1, should trigger watcher
  await fs.writeFile(filePath1, contents(4), "utf8");
  await next();
  t.is(
    log.debugs[0],
    `${relativeFilePath1} changed, reloading ${reloading}...`
  );

  // Update wrangler.toml, this should switch the watched path
  log.debugs = [];
  await fs.writeFile(
    wranglerConfigPath,
    wranglerConfigContents(filePath2),
    "utf8"
  );
  await next();
  t.is(
    log.debugs[0],
    `${relativeWranglerConfigPath} changed, reloading options...`
  );
  const unwatchIndex = log.debugs.findIndex((s) => s.startsWith("Unwatching"));
  t.is(log.debugs[unwatchIndex], `Unwatching ${relativeFilePath1}...`);
  t.is(log.debugs[unwatchIndex + 1], `Watching ${relativeFilePath2}...`);

  // Update filePath1, shouldn't trigger change now
  log.debugs = [];
  await fs.writeFile(filePath1, contents(5), "utf8");
  // Update filePath2, should trigger watcher now
  await fs.writeFile(filePath2, contents(6), "utf8");
  await next();
  t.is(
    log.debugs[0],
    `${relativeFilePath2} changed, reloading ${reloading}...`
  );
};
test.skip("switches watched path for script path", switchMacro, {
  reloading: "scripts",
  fileNamePrefix: "test.js",
  contents: (i) => `// test${i}`,
  wranglerConfigContents: (watchedFile) =>
    `[build.upload]\nmain = "${watchedFile}"`,
});
test.skip("switches watched path for env file", switchMacro, {
  reloading: "options",
  fileNamePrefix: ".env",
  contents: (i) => `KEY=value${i}`,
  wranglerConfigContents: (watchedFile) =>
    `[miniflare]\nenv_path = "${watchedFile}"`,
  initialOptions: { script: "// test" },
});
test.skip("switches watched path for durable object scripts", switchMacro, {
  reloading: "scripts",
  fileNamePrefix: "object.js",
  contents: (i) => `// object${i}`,
  wranglerConfigContents: (watchedFile) =>
    `[durable_objects]\nbindings = [ { name = "OBJECT", class_name = "Object", script_name = "${watchedFile}" } ]`,
  initialOptions: { script: "// test" },
});
// TODO: (low priority) test switches watched path for build watch path & wasm bindings

test("reloadScripts: reloads scripts manually", async (t) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const scriptPath = path.join(tmp, "test.js");
  const relativeScriptPath = path.relative("", scriptPath);
  await fs.writeFile(scriptPath, "// test1", "utf8");

  const watcher = new OptionsWatcher(log, callback, { scriptPath });

  let options = await next();
  t.deepEqual(log.debugs, ["Options:", `- Scripts: ${relativeScriptPath}`]);
  t.is(options.scripts?.[scriptPath].code, "// test1");

  // Update script, this shouldn't reload scripts yet
  log.debugs = [];
  await fs.writeFile(scriptPath, "// test2", "utf8");
  // Manually reload scripts
  await watcher.reloadScripts();
  options = await next();
  t.deepEqual(log.debugs, []);
  t.is(options.scripts?.[scriptPath].code, "// test2");
});
test("reloadOptions: reloads options manually", async (t) => {
  const { callback, next } = t.context;
  const log = new TestLog();

  const tmp = await useTmp(t);
  const envPath = path.join(tmp, ".env");
  await fs.writeFile(envPath, "KEY=value1", "utf8");

  const watcher = new OptionsWatcher(log, callback, {
    script: "// test",
    envPath,
  });

  let options = await next();
  t.deepEqual(log.debugs, [
    "Options:",
    `- Scripts: <script>`,
    `- Bindings: KEY`,
  ]);
  t.is(options.bindings?.KEY, "value1");

  // Update env, this shouldn't reload options yet
  log.debugs = [];
  await fs.writeFile(envPath, "KEY=value2", "utf8");
  // Manually reload options
  await watcher.reloadOptions(false);
  options = await next();
  t.deepEqual(log.debugs, []);
  t.is(options.bindings?.KEY, "value2");
});
