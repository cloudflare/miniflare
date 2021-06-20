import path from "path";
import test, { Macro } from "ava";
import { Miniflare, NoOpLog, Options, Request } from "../../src";
import { SitesModule } from "../../src/modules/sites";

test("buildEnvironment: provides empty sandbox if no site", (t) => {
  const module = new SitesModule(new NoOpLog());
  const sandbox = module.buildEnvironment({});
  t.deepEqual(sandbox, {});
});

type Path = keyof typeof pathContents;
const pathContents = {
  "/": "<p>Index</p>",
  "/a.txt": "a",
  "/b/b.txt": "b",
};

const getMacro: Macro<[Options, Set<Path>]> = async (
  t,
  options,
  expectedPaths
) => {
  const mf = new Miniflare({
    ...options,
    wranglerConfigPath: path.resolve(
      __dirname,
      "..",
      "fixtures",
      "sites",
      "wrangler.toml"
    ),
  });

  for (const [path, expectedContents] of Object.entries(pathContents)) {
    const res = await mf.dispatchFetch(
      new Request(`http://localhost:8787${path}`)
    );
    const expected = expectedPaths.has(path as Path);
    t.is(res.status, expected ? 200 : 404, path);
    if (expected) t.is((await res.text()).trim(), expectedContents, path);
  }
};
getMacro.title = (providedTitle) => `buildEnvironment: ${providedTitle}`;

test(
  "gets all assets with no filter",
  getMacro,
  {},
  new Set<Path>(["/", "/a.txt", "/b/b.txt"])
);
test(
  "gets included assets with include filter",
  getMacro,
  { siteInclude: ["b"] },
  new Set<Path>(["/b/b.txt"])
);
test(
  "gets all but excluded assets with include filter",
  getMacro,
  { siteExclude: ["b"] },
  new Set<Path>(["/", "/a.txt"])
);
test(
  "gets included assets with include and exclude filters",
  getMacro,
  { siteInclude: ["*.txt"], siteExclude: ["b"] },
  new Set<Path>(["/a.txt", "/b/b.txt"])
);
