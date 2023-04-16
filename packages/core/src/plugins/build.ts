import assert from "assert";
import childProcess from "child_process";
import path from "path";
import {
  Awaitable,
  BeforeSetupResult,
  MiniflareError,
  Option,
  OptionType,
  Plugin,
  PluginContext,
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
    fromWrangler: ({ build, miniflare }) => {
      const watchPaths = miniflare?.build_watch_dirs ?? [];
      if (build?.watch_dir) {
        watchPaths.push(
          ...(Array.isArray(build.watch_dir)
            ? build.watch_dir
            : [build.watch_dir])
        );
      }
      if (watchPaths.length) return watchPaths;

      // If build command set and no paths set, fallback to watching "src"
      if (build?.command) return ["src"];
    },
  })
  buildWatchPaths?: string[];

  constructor(ctx: PluginContext, options?: BuildOptions) {
    super(ctx);
    this.assignOptions(options);
  }

  beforeSetup(): Awaitable<BeforeSetupResult> {
    const buildCommand = this.buildCommand;
    if (!buildCommand) return {};

    // Only run build if buildCommand specified
    return new Promise((resolve, reject) => {
      const build = childProcess.spawn(buildCommand, {
        // Resolve build cwd relative to plugin root path,
        // defaulting to root path if not specified
        cwd: this.buildBasePath
          ? path.resolve(this.ctx.rootPath, this.buildBasePath)
          : this.ctx.rootPath,
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

        this.ctx.log.info("Build succeeded");

        // Resolve all watch paths relative to plugin root
        const watch = this.buildWatchPaths?.map((watchPath) =>
          path.resolve(this.ctx.rootPath, watchPath)
        );
        resolve({ watch });
      });
    });
  }
}

/** @internal */
export function _populateBuildConfig(
  config: WranglerConfig,
  configDir: string,
  configEnv?: string
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

  // Make sure to pass the correct --env to `wrangler build` so the correct
  // webpack_config is loaded
  const env = configEnv ? ` --env ${configEnv}` : "";

  if (config.type === "webpack") {
    let packageDir = "";
    if (config.site) {
      // If `site` is configured, built artifacts are isolated from static-site
      // application code, see:
      // - https://github.com/cloudflare/wrangler/blob/a3bc640f13c8a4d10f3211b577037f7c32aff7ae/src/settings/toml/target.rs#L38-L48
      // - https://github.com/cloudflare/wrangler/blob/a3bc640f13c8a4d10f3211b577037f7c32aff7ae/src/settings/toml/site.rs#L30-L40
      packageDir = config.site["entry-point"] ?? "workers-site";
    }

    config.build.command = `wrangler build${env}`;
    config.build.upload.main = path.join(packageDir, "worker", "script.js");

    // Rerun webpack on changes in src or index.js
    // TODO (someday): this should be based off the webpack config entrypoint,
    //  but this is the default, and users can always set custom watch paths
    config.miniflare ??= {};
    config.miniflare.build_watch_dirs = ["src", "index.js"];
  } else if (config.type === "rust") {
    // This script will be included in the root index.js bundle, but rust.mjs
    // will be in the plugins subdirectory
    const rustScript = path.join(__dirname, "plugins", "rust.js");
    config.build.command = `wrangler build${env} && ${process.execPath} ${rustScript}`;
    config.build.upload.main = path.join("worker", "generated", "script.js");

    // Add wasm binding, script.wasm will be created by rustScript
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
