import path from "path";
import { URL } from "url";
import test from "ava";
import { logOptions, stringScriptPath } from "../../src/options";
import { ScriptBlueprint } from "../../src/scripts";
import { TestLog } from "../helpers";

const regexp1 = /1/;
const regexp2 = /2/;
const regexp3 = /3/;
regexp1.toString = () => "regexp1";
regexp2.toString = () => "regexp2";
regexp3.toString = () => "regexp3";

test("logOptions: ignores undefined options", (t) => {
  const log = new TestLog();
  logOptions(log, {});
  t.deepEqual(log.debugs, ["Options:"]);
});

test("logOptions: logs all options", (t) => {
  const log = new TestLog();

  const scriptPath = path.resolve("src", "index.js");

  logOptions(log, {
    buildCommand: "npm run build",
    buildBasePath: "src",
    scripts: {
      [stringScriptPath]: new ScriptBlueprint("", stringScriptPath),
      [scriptPath]: new ScriptBlueprint("", scriptPath),
    },
    modules: true,
    processedModulesRules: [
      { type: "ESModule", include: [regexp1, regexp2] },
      { type: "Text", include: [regexp3] },
    ],
    upstreamUrl: new URL("https://miniflare.dev/"),
    validatedCrons: ["30 * * * *"],
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: "kv-data",
    cachePersist: false,
    disableCache: true,
    sitePath: "public",
    siteIncludeRegexps: [regexp1, regexp2],
    processedDurableObjects: [
      { name: "OBJECT1", className: "Object1", scriptPath: "" },
      { name: "OBJECT2", className: "Object2", scriptPath: "" },
    ],
    durableObjectsPersist: true,
    bindings: { KEY: "value" },
    https: true,
  });

  t.deepEqual(log.debugs, [
    "Options:",
    "- Build Command: npm run build",
    "- Build Base Path: src",
    `- Scripts: <script>, ${path.join("src", "index.js")}`,
    "- Modules: true",
    "- Modules Rules: {ESModule: regexp1, regexp2}, {Text: regexp3}",
    "- Upstream: https://miniflare.dev",
    "- Crons: 30 * * * *",
    "- KV Namespaces: NAMESPACE1, NAMESPACE2",
    "- KV Persistence: kv-data",
    "- Cache Persistence: false",
    "- Cache Disabled: true",
    "- Workers Site Path: public",
    "- Workers Site Include: regexp1, regexp2",
    "- Durable Objects: OBJECT1, OBJECT2",
    "- Durable Objects Persistence: true",
    "- Bindings: KEY",
    "- HTTPS: Self-Signed",
  ]);
});

test("logOptions: doesn't log build base path if current working directory", (t) => {
  const log = new TestLog();
  logOptions(log, {
    buildBasePath: process.cwd(),
  });
  t.deepEqual(log.debugs, ["Options:"]);
});
test("logOptions: only logs module rules if modules enabled", (t) => {
  const log = new TestLog();
  logOptions(log, {
    modules: false,
    processedModulesRules: [{ type: "ESModule", include: [regexp1] }],
  });
  t.deepEqual(log.debugs, ["Options:"]);

  log.debugs = [];
  logOptions(log, {
    modules: true,
    processedModulesRules: [{ type: "ESModule", include: [regexp1] }],
  });
  t.deepEqual(log.debugs, [
    "Options:",
    "- Modules: true",
    "- Modules Rules: {ESModule: regexp1}",
  ]);
});

test("logOptions: only logs site exclude if no include", (t) => {
  const log = new TestLog();
  logOptions(log, {
    siteExcludeRegexps: [regexp1, regexp2],
  });
  t.deepEqual(log.debugs, [
    "Options:",
    "- Workers Site Exclude: regexp1, regexp2",
  ]);

  log.debugs = [];
  logOptions(log, {
    siteExcludeRegexps: [regexp1, regexp2],
    siteIncludeRegexps: [regexp3],
  });
  t.deepEqual(log.debugs, ["Options:", "- Workers Site Include: regexp3"]);
});

test("logOptions: logs https option correctly", (t) => {
  // Check undefined (no HTTPS)
  const log = new TestLog();
  logOptions(log, { https: undefined });
  t.deepEqual(log.debugs, ["Options:"]);

  // Check false (no HTTPS)
  log.debugs = [];
  logOptions(log, { https: false });
  t.deepEqual(log.debugs, ["Options:"]);

  // Check default self-signed configuration
  log.debugs = [];
  logOptions(log, { https: true });
  t.deepEqual(log.debugs, ["Options:", "- HTTPS: Self-Signed"]);

  // Check custom, but still self-signed configuration
  log.debugs = [];
  logOptions(log, { https: "custom" });
  t.deepEqual(log.debugs, ["Options:", "- HTTPS: Self-Signed: custom"]);

  // Check custom configuration
  log.debugs = [];
  logOptions(log, { https: { key: "key", cert: "cert" } });
  t.deepEqual(log.debugs, ["Options:", "- HTTPS: Custom"]);
});
