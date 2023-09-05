import assert from "assert";
import path from "path";
import test from "ava";
import esbuild from "esbuild";
import { Miniflare } from "miniflare";
import { useTmp } from "./storage";

const FIXTURES_PATH = path.resolve(
  require.resolve("miniflare"),
  "..",
  "..",
  "..",
  "test",
  "fixtures"
);

export const workerTestMacro = test.macro(
  async (t, ...fixturePath: string[]) => {
    const tmp = await useTmp(t);
    await esbuild.build({
      entryPoints: [path.join(FIXTURES_PATH, ...fixturePath)],
      format: "esm",
      external: ["node:assert", "node:buffer", "miniflare:shared"],
      bundle: true,
      sourcemap: true,
      outdir: tmp,
    });
    const entryFileName = fixturePath.at(-1);
    assert(entryFileName !== undefined);
    const outputFileName =
      entryFileName.substring(0, entryFileName.lastIndexOf(".")) + ".js";

    const mf = new Miniflare({
      modulesRoot: tmp,
      modules: [{ type: "ESModule", path: path.join(tmp, outputFileName) }],
      compatibilityDate: "2023-08-01",
      compatibilityFlags: ["nodejs_compat", "experimental"],
    });
    t.teardown(() => mf.dispose());

    const response = await mf.dispatchFetch("http://localhost");
    t.true(response.ok, await response.text());
  }
);
