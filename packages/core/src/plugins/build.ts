import assert from "assert";
import childProcess from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  BeforeSetupResult,
  Log,
  MaybePromise,
  MiniflareError,
  Option,
  OptionType,
  Plugin,
  WranglerConfig,
} from "@miniflare/shared";

export type BuildErrorCode = "ERR_FAILED"; // Build failed with non-zero exit code

export class BuildError extends MiniflareError<BuildErrorCode> {
  constructor(
    code: BuildErrorCode,
    readonly exitCode: number | null,
    message?: string
  ) {
    super(code, message);
  }
}

export interface BuildOptions {
  buildCommand?: string;
  buildBasePath?: string;
  buildWatchPaths?: string[];
}

export function autoPopulateBuildConfiguration(
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
    // This script will be included in the root index.mjs bundle, but rust.mjs
    // will be in the plugins subdirectory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rustScript = path.join(__dirname, "plugins", "rust.js");
    config.build.command = `wrangler build && ${process.execPath} ${rustScript}`;
    config.build.upload.main = path.join("worker", "generated", "script.js");

    // Add wasm binding, script.wasm will be created by rustScript
    if (!config.miniflare) config.miniflare = {};
    if (!config.miniflare.wasm_bindings) config.miniflare.wasm_bindings = [];
    config.miniflare.wasm_bindings.push({
      name: "wasm",
      // WASM bindings aren't implicitly resolved relative to configDir
      path: path.join(configDir, "worker", "generated", "script.wasm"),
    });
  }
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

  constructor(log: Log, options?: BuildOptions) {
    super(log);
    this.assignOptions(options);
  }

  beforeSetup(): MaybePromise<BeforeSetupResult> {
    const buildCommand = this.buildCommand;
    if (!buildCommand) return {};

    // Only run build if buildCommand specified
    return new Promise((resolve, reject) => {
      const build = childProcess.spawn(buildCommand, {
        cwd: this.buildBasePath,
        shell: true,
        // Pass-through stdin/stdout
        stdio: "inherit",
      });
      build.on("exit", (exitCode) => {
        if (exitCode !== 0) {
          const error = new BuildError(
            "ERR_FAILED",
            exitCode,
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
