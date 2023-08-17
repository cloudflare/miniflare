import { pkgsList } from "./scripts/common.mjs";

const rewritePaths = Object.fromEntries(
  pkgsList.map((pkgName) => [
    `packages/${pkgName}/test/`,
    `packages/${pkgName}/dist/test/`,
  ])
);

export default {
  files: ["packages/*/test/**/*.spec.ts"],
  nodeArguments: ["--no-warnings", "--experimental-vm-modules"],
  require: ["./packages/miniflare/test/setup.mjs"],
  workerThreads: false,
  typescript: {
    compile: false,
    rewritePaths,
  },
  environmentVariables: {
    MINIFLARE_ASSERT_BODIES_CONSUMED: "true",
  },
};
