export default {
  nonSemVerExperiments: {
    configurableModuleFormat: true,
  },
  extensions: { ts: "module" },
  files: ["packages/*/test/**/*.spec.ts"],
  timeout: "5m",
  nodeArguments: [
    "--no-warnings",
    "--enable-source-maps",
    "--experimental-vm-modules",
    "--experimental-loader",
    "./scripts/tsloader.mjs",
  ],
};
