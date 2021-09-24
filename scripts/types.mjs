import path from "path";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { getPackage, pkgsDir, pkgsList, projectRoot } from "./common.mjs";

// TODO: consider using more of api-extractor, it's got lots of nifty features

// noinspection JSValidateJSDoc
/** @type {IConfigFile} */
const extractorCfgObject = {
  projectFolder: "<lookup>",
  mainEntryPointFilePath:
    "<projectFolder>/dist/packages/<unscopedPackageName>/src/index.d.ts",
  compiler: { tsconfigFilePath: path.join(projectRoot, "tsconfig.json") },
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
    untrimmedFilePath:
      "<projectFolder>/packages/<unscopedPackageName>/dist/src/index.d.ts",
    betaTrimmedFilePath: "",
    publicTrimmedFilePath: "",
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
    warningCount += extractorRes.warningCount;
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
  if (failed) process.exit(1);
}

// Bundle all packages' types
await buildTypes();
