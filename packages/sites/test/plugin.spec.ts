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
    { log, compat, rootPath: tmp, queueBroker, queueEventDispatcher },
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

  // Check same setup result is always returned
  t.is(await plugin.setup(), result);
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
  const mf = useMiniflare(
    { SitesPlugin, CachePlugin },
    { scriptPath: sitesScriptPath, sitePath: tmp }
  );

  await fs.writeFile(testPath, "1", "utf8");
  const res1 = await mf.dispatchFetch(
    new Request("http://localhost:8787/test.txt")
  );
  t.false(res1.headers.has("CF-Cache-Status"));
  t.is(await res1.text(), "1");

  await fs.writeFile(testPath, "2", "utf8");
  const res2 = await mf.dispatchFetch(
    new Request("http://localhost:8787/test.txt")
  );
  t.false(res2.headers.has("CF-Cache-Status"));
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
