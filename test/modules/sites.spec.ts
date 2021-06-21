import { promises as fs } from "fs";
import path from "path";
import test, { Macro } from "ava";
import { Miniflare, NoOpLog, Options, Request } from "../../src";
import { SitesModule } from "../../src/modules/sites";
import { useTmp } from "../helpers";

test("buildEnvironment: provides empty sandbox if no site", (t) => {
  const module = new SitesModule(new NoOpLog());
  const sandbox = module.buildEnvironment({});
  t.deepEqual(sandbox, {});
});

test("buildEnvironment: content namespace is read-only", async (t) => {
  const tmp = await useTmp(t);
  const module = new SitesModule(new NoOpLog());
  const environment = module.buildEnvironment({ sitePath: tmp });
  await t.throwsAsync(() => environment.__STATIC_CONTENT.put("key", "value"), {
    instanceOf: TypeError,
    message: "Unable to put into read-only namespace",
  });
  await t.throwsAsync(() => environment.__STATIC_CONTENT.delete("key"), {
    instanceOf: TypeError,
    message: "Unable to delete from read-only namespace",
  });
});

const fixtureWranglerConfigPath = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "sites",
  "wrangler.toml"
);

type FixturePath = keyof typeof fixturePathContents;
const fixturePathContents = {
  "/": "<p>Index</p>",
  "/a.txt": "a",
  "/b/b.txt": "b",
};

const getMacro: Macro<[Options, Set<FixturePath>]> = async (
  t,
  options,
  expectedPaths
) => {
  const mf = new Miniflare({
    ...options,
    wranglerConfigPath: fixtureWranglerConfigPath,
  });

  for (const [path, expectedContents] of Object.entries(fixturePathContents)) {
    const res = await mf.dispatchFetch(
      new Request(`http://localhost:8787${path}`)
    );
    const expected = expectedPaths.has(path as FixturePath);
    const text = (await res.text()).trim();
    t.is(res.status, expected ? 200 : 404, `${path}: ${text}`);
    if (expected) t.is(text, expectedContents, path);
  }
};
getMacro.title = (providedTitle) => `buildEnvironment: ${providedTitle}`;

test(
  "gets all assets with no filter",
  getMacro,
  {},
  new Set<FixturePath>(["/", "/a.txt", "/b/b.txt"])
);
test(
  "gets included assets with include filter",
  getMacro,
  { siteInclude: ["b"] },
  new Set<FixturePath>(["/b/b.txt"])
);
test(
  "gets all but excluded assets with include filter",
  getMacro,
  { siteExclude: ["b"] },
  new Set<FixturePath>(["/", "/a.txt"])
);
test(
  "gets included assets with include and exclude filters",
  getMacro,
  { siteInclude: ["*.txt"], siteExclude: ["b"] },
  new Set<FixturePath>(["/a.txt", "/b/b.txt"])
);

test("buildEnvironment: doesn't cache files", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  const mf = new Miniflare({
    wranglerConfigPath: fixtureWranglerConfigPath,
    sitePath: tmp,
  });

  await fs.writeFile(testPath, "1", "utf8");
  const res1 = await mf.dispatchFetch(
    new Request(`http://localhost:8787/test.txt`)
  );
  t.false(res1.headers.has("CF-Cache-Status"));
  t.is(await res1.text(), "1");

  await fs.writeFile(testPath, "2", "utf8");
  const res2 = await mf.dispatchFetch(
    new Request(`http://localhost:8787/test.txt`)
  );
  t.false(res2.headers.has("CF-Cache-Status"));
  t.is(await res2.text(), "2");
});
