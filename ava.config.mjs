import inspector from "inspector";
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
  workerThreads: inspector.url() === undefined,
  typescript: {
    compile: false,
    rewritePaths,
  },
};
