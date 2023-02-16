import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { CachePlugin } from "@miniflare/cache";
import { Request } from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
} from "@miniflare/shared";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
  useMiniflare,
  useTmp,
} from "@miniflare/shared-test";
import { SitesOptions, SitesPlugin } from "@miniflare/sites";
import test, { Macro } from "ava";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: unusable(),
};

test("SitesPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(SitesPlugin, [
    "--site",
    "path",
    "--site-include",
    "*.html",
    "--site-include",
    "*.jpg",
    "--site-exclude",
    "*.txt",
  ]);
  t.deepEqual(options, {
    sitePath: "path",
    siteInclude: ["*.html", "*.jpg"],
    siteExclude: ["*.txt"],
  });
  options = parsePluginArgv(SitesPlugin, ["-s", "site"]);
  t.deepEqual(options, { sitePath: "site" });
});
test("SitesPlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(SitesPlugin, {
    site: {
      bucket: "path",
      include: ["*.html"],
      exclude: ["*.txt", "*.jpg"],
    },
  });
  t.deepEqual(options, {
    sitePath: "path",
    siteInclude: ["*.html"],
    siteExclude: ["*.txt", "*.jpg"],
  });
});
test("SitesPlugin: logs options", (t) => {
  const logs = logPluginOptions(SitesPlugin, {
    sitePath: "path",
    siteInclude: ["*.html", "*.jpg"],
    siteExclude: ["*.txt"],
  });
  t.deepEqual(logs, [
    "Workers Site Path: path",
    "Workers Site Include: *.html, *.jpg",
    "Workers Site Exclude: *.txt",
  ]);
});
test("SitesPlugin: setup: returns empty result if no site", async (t) => {
  const plugin = new SitesPlugin(ctx);
  const result = await plugin.setup();
  t.deepEqual(result, {});
});
test("SitesPlugin: setup: includes read-only content namespace and watches files", async (t) => {
  const tmp = await useTmp(t);
  const plugin = new SitesPlugin(
    { ...ctx, rootPath: tmp },
    { sitePath: "site" }
  );
  const result = await plugin.setup();

  // Check namespace is read-only
  const bindings = result.bindings;
  await t.throwsAsync(() => bindings?.__STATIC_CONTENT.put("key", "value"), {
    instanceOf: TypeError,
    message: "Unable to put into read-only namespace",
  });
  await t.throwsAsync(() => bindings?.__STATIC_CONTENT.delete("key"), {
    instanceOf: TypeError,
    message: "Unable to delete from read-only namespace",
  });

  // Check files watched
  t.deepEqual(result.watch, [path.join(tmp, "site")]);
});
test("SitesPlugin: setup: includes populated manifest", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/233
  const tmp = await useTmp(t);
  const dir = path.join(tmp, "a", "b", "c");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "1.txt"), "test1", "utf8");
  await fs.writeFile(path.join(tmp, "2.txt"), "test2", "utf8");
  await fs.writeFile(path.join(tmp, "3.txt"), "test3", "utf8");
  await fs.writeFile(path.join(tmp, "4.jsx"), "test4", "utf8");

  const plugin = new SitesPlugin(
    { ...ctx, rootPath: tmp },
    { sitePath: tmp, siteInclude: ["*.txt"], siteExclude: ["3.txt"] }
  );
  let result = await plugin.setup();

  // Check manifest includes subdirectories, and respects include/exclude
  let manifestJSON = result.bindings?.__STATIC_CONTENT_MANIFEST;
  assert(typeof manifestJSON === "string");
  let manifest = JSON.parse(manifestJSON);
  t.deepEqual(manifest, {
    "2.txt": "$__MINIFLARE_SITES__$/2.txt",
    "a/b/c/1.txt": "$__MINIFLARE_SITES__$/a%2Fb%2Fc%2F1.txt",
  });

  // Check manifest rebuilt on new file
  await fs.writeFile(path.join(tmp, "5.txt"), "test5", "utf8");
  result = await plugin.setup();
  manifestJSON = result.bindings?.__STATIC_CONTENT_MANIFEST;
  assert(typeof manifestJSON === "string");
  manifest = JSON.parse(manifestJSON);
  t.deepEqual(manifest, {
    "2.txt": "$__MINIFLARE_SITES__$/2.txt",
    "5.txt": "$__MINIFLARE_SITES__$/5.txt",
    "a/b/c/1.txt": "$__MINIFLARE_SITES__$/a%2Fb%2Fc%2F1.txt",
  });
});

// Path to worker script with @cloudflare/kv-asset-handler bundled
const sitesScriptPath = path.resolve(
  __dirname,
  "fixtures",
  "plugin.assetHandler.js"
);
const sitesModulesScriptPath = path.resolve(
  __dirname,
  "fixtures",
  "plugin.assetHandler.modules.js"
);

type Route = keyof typeof routeContents;
const routeContents = {
  "/": "<p>Index</p>",
  "/a.txt": "a",
  "/b/b.txt": "b",
};

const getMacro: Macro<[SitesOptions, Set<Route>]> = async (
  t,
  options,
  expectedRoutes
) => {
  const tmp = await useTmp(t);
  for (const [route, contents] of Object.entries(routeContents)) {
    const routePath = path.join(tmp, route === "/" ? "index.html" : route);
    await fs.mkdir(path.dirname(routePath), { recursive: true });
    await fs.writeFile(routePath, contents, "utf8");
  }

  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { ...options, scriptPath: sitesScriptPath, sitePath: tmp }
  );

  for (const [route, expectedContents] of Object.entries(routeContents)) {
    const res = await mf.dispatchFetch(
      new Request(`http://localhost:8787${route}`)
    );
    const expected = expectedRoutes.has(route as Route);
    const text = (await res.text()).trim();
    t.is(res.status, expected ? 200 : 404, `${route}: ${text}`);
    if (expected) t.is(text, expectedContents, route);
  }
};
getMacro.title = (providedTitle) => `MiniflareCore: ${providedTitle}`;

test(
  "gets all assets with no filter",
  getMacro,
  {},
  new Set<Route>(["/", "/a.txt", "/b/b.txt"])
);
test(
  "gets included assets with include filter",
  getMacro,
  { siteInclude: ["b"] },
  new Set<Route>(["/b/b.txt"])
);
test(
  "gets all but excluded assets with include filter",
  getMacro,
  { siteExclude: ["b"] },
  new Set<Route>(["/", "/a.txt"])
);
test(
  "gets included assets with include and exclude filters",
  getMacro,
  { siteInclude: ["*.txt"], siteExclude: ["b"] },
  new Set<Route>(["/a.txt", "/b/b.txt"])
);

// Tests for checking different types of globs are matched correctly
const matchMacro: Macro<[string]> = async (t, include) => {
  const tmp = await useTmp(t);
  const dir = path.join(tmp, "a", "b", "c");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "test.txt"), "test", "utf8");
  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { siteInclude: [include], scriptPath: sitesScriptPath, sitePath: tmp }
  );
  const res = await mf.dispatchFetch(
    new Request(`http://localhost:8787/a/b/c/test.txt`)
  );
  t.is(res.status, 200);
};
matchMacro.title = (providedTitle) => `MiniflareCore: ${providedTitle}`;

test("matches file name pattern", matchMacro, "test.txt");
test("matches exact pattern", matchMacro, "a/b/c/test.txt");
test("matches extension patterns", matchMacro, "*.txt");
test("matches globstar patterns", matchMacro, "**/*.txt");
test("matches wildcard directory patterns", matchMacro, "a/*/c/*.txt");

test("MiniflareCore: doesn't cache files", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "1", "utf8");

  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { scriptPath: sitesScriptPath, sitePath: tmp }
  );

  const res1 = await mf.dispatchFetch(
    new Request("http://localhost:8787/test.txt")
  );
  t.is(res1.headers.get("CF-Cache-Status"), "MISS");
  t.is(await res1.text(), "1");

  await fs.writeFile(testPath, "2", "utf8");
  const res2 = await mf.dispatchFetch(
    new Request("http://localhost:8787/test.txt")
  );
  t.is(res2.headers.get("CF-Cache-Status"), "MISS");
  t.is(await res2.text(), "2");
});

test("MiniflareCore: gets assets with module worker", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "test", "utf8");
  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { modules: true, scriptPath: sitesModulesScriptPath, sitePath: tmp }
  );
  const res = await mf.dispatchFetch("http://localhost:8787/test.txt");
  t.is(await res.text(), "test");
});

test("MiniflareCore: gets assets with percent-encoded paths", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/326
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "ń.txt");
  await fs.writeFile(testPath, "test", "utf8");
  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { scriptPath: sitesScriptPath, sitePath: tmp }
  );
  const res = await mf.dispatchFetch("http://localhost:8787/ń.txt");
  t.is(await res.text(), "test");
});
