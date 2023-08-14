import fs from "fs/promises";
import path from "path";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { getPackage, pkgsDir, pkgsList, projectRoot } from "./common.mjs";

// TODO: consider using more of api-extractor, it's got lots of nifty features
//  (automatic API docs in package READMEs?)

// noinspection JSValidateJSDoc
/** @type {IConfigFile} */
const extractorCfgObject = {
  projectFolder: "<lookup>",
  mainEntryPointFilePath:
    "<projectFolder>/dist/packages/<unscopedPackageName>/src/index.d.ts",
  compiler: {
    tsconfigFilePath: path.join(projectRoot, "tsconfig.bundle.json"),
  },
  apiReport: {
    enabled: false,
    reportFileName: "<unscopedPackageName>.api.md",
    reportFolder: "<projectFolder>/etc/",
    reportTempFolder: "<projectFolder>/temp/",
  },
  docModel: {
    enabled: false,
    apiJsonFilePath: "<projectFolder>/temp/<unscopedPackageName>.api.json",
  },
  dtsRollup: {
    enabled: true,
    untrimmedFilePath: "",
    betaTrimmedFilePath: "",
    publicTrimmedFilePath:
      "<projectFolder>/packages/<unscopedPackageName>/dist/src/index.d.ts",
    omitTrimmingComments: false,
  },
  tsdocMetadata: {
    enabled: false,
    tsdocMetadataFilePath: "<lookup>",
  },
  messages: {
    compilerMessageReporting: {
      default: { logLevel: "warning" },
    },
    extractorMessageReporting: {
      default: { logLevel: "warning" },
      "ae-missing-release-tag": { logLevel: "none" },
    },
  },
};

/**
 * Bundle types for each package into single .d.ts files and run other checks
 * on definitions (e.g. forgotten exports). Requires `tsc` be run in the root
 * of the repository before running this script.
 * @returns {Promise<void>}
 */
async function buildTypes() {
  let errorCount = 0;
  let warningCount = 0;
  for (const name of pkgsList) {
    console.log(`\n--> Bundling ${name}'s types...`);
    const pkgRoot = path.join(pkgsDir, name);

    if (name === "miniflare") {
      await fs.copyFile(
        path.join(pkgRoot, "src", "runtime", "config", "workerd.capnp.d.ts"),
        path.join(
          projectRoot,
          "dist",
          "packages",
          "miniflare",
          "src",
          "runtime",
          "config",
          "workerd.capnp.d.ts"
        )
      );
    }

    const extractorCfg = ExtractorConfig.prepare({
      projectFolderLookupToken: projectRoot,
      packageJsonFullPath: path.join(pkgRoot, "package.json"),
      packageJson: await getPackage(pkgRoot),
      configObjectFullPath: path.join(pkgRoot, "api-extractor.json"),
      configObject: extractorCfgObject,
    });

    const extractorRes = Extractor.invoke(extractorCfg, {
      localBuild: true,
      showVerboseMessages: true,
    });
    errorCount += extractorRes.errorCount;
    if (name !== "jest-environment-miniflare") {
      // Ignore `jest-environment-miniflare` warnings. This package will never
      // be used directly so correct type definitions aren't critical. We have
      // integration tests for this package anyways, so if something breaks,
      // we'll know.
      // TODO: work out why these warnings are being thrown
      warningCount += extractorRes.warningCount;
    }
  }
  const failed = errorCount + warningCount > 0;
  const colour = failed ? 31 : 32;
  console.log(
    [
      `\n\x1b[${colour}mBundled all types `,
      `with ${errorCount} error(s) and ${warningCount} warning(s)`,
      "\x1b[39m",
    ].join("")
  );
  if (failed) process.exitCode = 1;
}

// `api-extractor` doesn't know to load `index.ts` instead of `index.d.ts` when
// resolving imported types, so copy `index.ts` to `index.d.ts`, bundle types,
// then restore the original contents. We need the original `index.d.ts` for
// typing the `packages/miniflare/src/workers` directory.
const workersTypesExperimental = path.join(
  projectRoot,
  "node_modules",
  "@cloudflare",
  "workers-types",
  "experimental"
);
const indexTsPath = path.join(workersTypesExperimental, "index.ts");
const indexDtsPath = path.join(workersTypesExperimental, "index.d.ts");
const originalDtsContent = await fs.readFile(indexDtsPath);
await fs.copyFile(indexTsPath, indexDtsPath);

try {
  // Bundle all packages' types
  await buildTypes();
} finally {
  await fs.writeFile(indexDtsPath, originalDtsContent);
}
