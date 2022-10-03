import { pkgsList } from "./scripts/common.mjs";

const rewritePaths = Object.fromEntries(
  pkgsList.map((pkgName) => [
    `packages/${pkgName}/test/`,
    `packages/${pkgName}/dist/test/`,
  ])
);

export default {
  nonSemVerExperiments: {
    nextGenConfig: true,
  },
  files: ["packages/*/test/**/*.spec.ts"],
  timeout: "5m",
  nodeArguments: ["--no-warnings", "--experimental-vm-modules"],
  typescript: {
    compile: false,
    rewritePaths,
  },
};
