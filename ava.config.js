export default {
  files: ["test/**/*.spec.ts"],
  extensions: ["ts"],
  require: ["ts-node/register"],
  timeout: "2m",
  nodeArguments: ["--experimental-vm-modules"],
};
