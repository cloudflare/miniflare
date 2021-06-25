export default {
  files: ["test/**/*.spec.ts"],
  extensions: ["ts"],
  require: ["ts-node/register"],
  timeout: "1m",
  nodeArguments: ["--experimental-vm-modules"],
};
