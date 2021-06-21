import path from "path";
import { URL } from "url";
import test from "ava";
import {
  logOptions,
  stringScriptPath,
  stripUndefinedOptions,
} from "../../src/options";
import { ScriptBlueprint } from "../../src/scripts";
import { TestLog } from "../helpers";

test("stripUndefinedOptions: removes undefined values", (t) => {
  t.deepEqual(
    stripUndefinedOptions({
      host: undefined,
      port: 8787,
    }),
    { port: 8787 }
  );
});

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
    upstreamUrl: new URL("https://mrbbot.dev/"),
    validatedCrons: ["30 * * * *"],
    kvNamespaces: ["NAMESPACE1", "NAMESPACE2"],
    kvPersist: "kv-data",
    cachePersist: false,
    sitePath: "public",
    siteIncludeRegexps: [regexp1, regexp2],
    durableObjects: [
      { name: "OBJECT1", className: "Object1" },
      { name: "OBJECT2", className: "Object2" },
    ],
    durableObjectPersist: true,
    bindings: { KEY: "value" },
  });

  t.deepEqual(log.debugs, [
    "Options:",
    "- Build Command: npm run build",
    "- Build Base Path: src",
    `- Scripts: <script>, ${path.join("src", "index.js")}`,
    "- Modules: true",
    "- Modules Rules: {ESModule: regexp1, regexp2}, {Text: regexp3}",
    "- Upstream: https://mrbbot.dev",
    "- Crons: 30 * * * *",
    "- KV Namespaces: NAMESPACE1, NAMESPACE2",
    "- KV Persistence: kv-data",
    "- Cache Persistence: false",
    "- Workers Site Path: public",
    "- Workers Site Include: regexp1, regexp2",
    "- Durable Objects: OBJECT1, OBJECT2",
    "- Durable Objects Persistence: true",
    "- Bindings: KEY",
  ]);
});

test("logOptions: only logs module rules if modules enabled", (t) => {
  const log = new TestLog();
  logOptions(log, {
    modules: false,
    processedModulesRules: [{ type: "ESModule", include: [regexp1] }],
  });
  t.deepEqual(log.debugs, ["Options:", "- Modules: false"]);

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
