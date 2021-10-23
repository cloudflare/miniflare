import assert from "assert";
import childProcess from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  Awaitable,
  BeforeSetupResult,
  Compatibility,
  Log,
  MiniflareError,
  Option,
  OptionType,
  Plugin,
  WranglerConfig,
} from "@miniflare/shared";

export class BuildError extends MiniflareError<number> {}

export interface BuildOptions {
  buildCommand?: string;
  buildBasePath?: string;
  buildWatchPaths?: string[];
}

export class BuildPlugin extends Plugin<BuildOptions> implements BuildOptions {
  @Option({
    type: OptionType.STRING,
    alias: "B",
    description: "Command to build project",
    fromWrangler: ({ build }) => build?.command,
  })
  buildCommand?: string;

  @Option({
    type: OptionType.STRING,
    description: "Working directory for build command",
    fromWrangler: ({ build }) => build?.cwd,
  })
  buildBasePath?: string;

  @Option({
    type: OptionType.ARRAY,
    description: "Directory to watch for rebuilding on changes",
    fromWrangler: ({ build }) => {
      if (build?.watch_dir) return [build.watch_dir];
      if (build?.command) return ["src"];
    },
  })
  buildWatchPaths?: string[];

  constructor(log: Log, compat: Compatibility, options?: BuildOptions) {
    super(log, compat);
    this.assignOptions(options);
  }

  beforeSetup(): Awaitable<BeforeSetupResult> {
    const buildCommand = this.buildCommand;
    if (!buildCommand) return {};

    // Only run build if buildCommand specified
    return new Promise((resolve, reject) => {
      const build = childProcess.spawn(buildCommand, {
        cwd: this.buildBasePath,
        shell: true,
        // Pass-through stdin/stdout
        stdio: "inherit",
        env: { ...process.env, MINIFLARE: "1" },
      });
      build.on("exit", (exitCode) => {
        if (exitCode !== 0) {
          const error = new BuildError(
            exitCode ?? 0,
            `Build failed with exit code ${exitCode}`
          );
          return reject(error);
        }

        this.log.info("Build succeeded");
        resolve({ watch: this.buildWatchPaths });
      });
    });
  }
}

export function populateBuildConfig(
  config: WranglerConfig,
  configDir: string
): void {
  // If there's already a build configuration, or this isn't a "webpack"/"rust"
  // type project, leave the config as is
  if (config.build || (config.type !== "webpack" && config.type !== "rust")) {
    return;
  }

  // Explicitly set dir to empty string, this will exclude it when resolving.
  // config.build.upload.main's below will be resolved relative to configDir
  config.build = { cwd: configDir, upload: { dir: "" } };
  assert(config.build.upload); // TypeScript gets annoyed if this isn't here

  if (config.type === "webpack") {
    config.build.command = "wrangler build";
    config.build.upload.main = path.join("worker", "script.js");
  } else if (config.type === "rust") {
    // This script will be included in the root index.js bundle, but rust.mjs
    // will be in the plugins subdirectory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rustScript = path.join(__dirname, "plugins", "rust.js");
    config.build.command = `wrangler build && ${process.execPath} ${rustScript}`;
    config.build.upload.main = path.join("worker", "generated", "script.js");

    // Add wasm binding, script.wasm will be created by rustScript
    config.miniflare ??= {};
    config.wasm_modules ??= {};
    // WASM bindings aren't implicitly resolved relative to configDir
    config.wasm_modules.wasm = path.join(
      configDir,
      "worker",
      "generated",
      "script.wasm"
    );
  }
}
