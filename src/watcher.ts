import childProcess from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { URL } from "url";
import chokidar from "chokidar";
import dotenv from "dotenv";
import micromatch from "micromatch";
import cron from "node-cron";
import { Log } from "./log";
import {
  ModuleRuleType,
  Options,
  ProcessedOptions,
  defaultModuleRules,
  logOptions,
  stringScriptPath,
} from "./options";
import { getWranglerOptions } from "./options/wrangler";
import { ScriptBlueprint, buildLinker } from "./scripts";

const noop = () => {};

const micromatchOptions: micromatch.Options = { contains: true };

export type WatchCallback = (options: ProcessedOptions) => void;

export class Watcher {
  private readonly _log: Log;
  private readonly _callback: WatchCallback;

  private readonly _initialOptions: Options;
  private readonly _wranglerConfigPath?: string;

  private _scriptBlueprints: Record<string, ScriptBlueprint>;
  private _options?: ProcessedOptions;

  private _watcher?: chokidar.FSWatcher;
  private _watchedPaths?: Set<string>;

  constructor(log: Log, callback: WatchCallback, options: Options) {
    this._log = log;
    this._callback = callback;

    // Setup initial options
    this._initialOptions = options;
    this._wranglerConfigPath = options.wranglerConfigPath
      ? path.resolve(options.wranglerConfigPath)
      : undefined;

    this._scriptBlueprints = {};
    void this._init();
  }

  private _getWatchedPaths(): Set<string> {
    const watchedPaths = new Set<string>();
    if (this._wranglerConfigPath) watchedPaths.add(this._wranglerConfigPath);
    if (this._options?.envPath) watchedPaths.add(this._options.envPath);
    if (this._options?.buildWatchPath)
      watchedPaths.add(this._options.buildWatchPath);
    if (this._options?.scriptPath) watchedPaths.add(this._options.scriptPath);
    for (const durableObject of this._options?.processedDurableObjects ?? []) {
      if (durableObject.scriptPath) watchedPaths.add(durableObject.scriptPath);
    }
    for (const wasmPath of Object.values(this._options?.wasmBindings ?? {})) {
      watchedPaths.add(wasmPath);
    }
    return watchedPaths;
  }

  private _runCustomBuild(command: string, basePath?: string): Promise<void> {
    return new Promise((resolve) => {
      // TODO: may want to mutex this, so only one build at a time
      const build = childProcess.spawn(command, {
        cwd: basePath,
        shell: true,
        stdio: "inherit",
      });
      build.on("exit", (code) => {
        if (code === 0) {
          this._log.info("Build succeeded");
        } else {
          this._log.error(`Build failed with exit code ${code}`);
        }
        resolve();
      });
    });
  }

  private async _init(): Promise<void> {
    // Yield initial values
    this._options = await this._getOptions(true);
    logOptions(this._log, this._options);
    this._callback(this._options);

    // Stop here if we're not watching files
    if (!this._options.watch) return;

    // Get an array of watched file paths, storing the watchedEnvPath explicitly
    // so we can tell if it changes later
    this._watchedPaths = this._getWatchedPaths();
    const watchedPaths = [...this._watchedPaths];
    this._log.debug(
      `Watching ${watchedPaths
        .map((filePath) => path.relative("", filePath))
        .sort()
        .join(", ")}...`
    );

    // Create watcher
    const boundCallback = this._watchedPathCallback.bind(this);
    this._watcher = chokidar
      .watch(watchedPaths)
      .on("change", boundCallback)
      .on("unlink", boundCallback);
  }

  private _watchedPathCallback(eventPath: string) {
    if (
      eventPath === this._wranglerConfigPath ||
      eventPath === this._options?.envPath
    ) {
      // If either the wrangler config or the env file changed, reload the
      // options from disk, taking into account the initialOptions
      this._log.debug(
        `${path.relative("", eventPath)} changed, reloading options...`
      );
      void this.reloadOptions();
    } else if (
      this._options?.buildWatchPath &&
      eventPath.startsWith(this._options.buildWatchPath)
    ) {
      if (this._options.buildCommand) {
        this._log.debug(
          `${path.relative("", eventPath)} changed, rebuilding...`
        );
        // Re-run build, this should change a script triggering the watcher
        // again
        void this._runCustomBuild(
          this._options.buildCommand,
          this._options.buildBasePath
        );
      }
    } else {
      // If the path isn't a config, or in buildWatchPath, it's a script or WASM
      // file, so just reload all scripts
      this._log.debug(
        `${path.relative("", eventPath)} changed, reloading scripts...`
      );
      void this.reloadScripts();
    }
  }

  async reloadScripts(): Promise<void> {
    this._scriptBlueprints = {};
    await this.reloadOptions(false);
  }

  async reloadOptions(log = true): Promise<void> {
    this._options = await this._getOptions();
    if (log) logOptions(this._log, this._options);

    if (this._watcher && this._watchedPaths) {
      // Update watched paths if we're watching files
      const newWatchedPaths = this._getWatchedPaths();
      for (const watchedPath of this._watchedPaths) {
        if (!newWatchedPaths.has(watchedPath)) {
          this._log.debug(`Unwatching ${path.relative("", watchedPath)}...`);
          this._watcher.unwatch(watchedPath);
        }
      }
      for (const newWatchedPath of newWatchedPaths) {
        if (!this._watchedPaths.has(newWatchedPath)) {
          this._log.debug(`Watching ${path.relative("", newWatchedPath)}...`);
          this._watcher.add(newWatchedPath);
        }
      }
      this._watchedPaths = newWatchedPaths;
    }

    this._callback(this._options);
  }

  private async _readFile(filePath: string, logError = true): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (e) {
      if (logError) {
        this._log.error(
          `Unable to read ${path.relative(
            "",
            filePath
          )}: ${e} (defaulting to empty string)`
        );
      }
      return "";
    }
  }

  private async _addScriptBlueprint(scriptPath: string) {
    if (scriptPath in this._scriptBlueprints) return;
    // Read file contents and create script object
    const code =
      scriptPath === stringScriptPath && this._initialOptions.script
        ? this._initialOptions.script
        : await this._readFile(scriptPath);
    this._scriptBlueprints[scriptPath] = new ScriptBlueprint(code, scriptPath);
  }

  private _globsToRegexps(globs?: string[]): RegExp[] {
    const regexps: RegExp[] = [];
    for (const glob of globs ?? []) {
      const regexp = micromatch.makeRe(glob, micromatchOptions) as
        | RegExp
        | false;
      if (regexp === false) {
        this._log.error(`Unable to parse glob "${glob}" (ignoring)`);
      } else {
        // Override toString so we log the glob not the regexp
        regexp.toString = () => glob;
        regexps.push(regexp);
      }
    }
    return regexps;
  }

  private async _getOptions(initial?: boolean): Promise<ProcessedOptions> {
    // Get wrangler options first (if set) since initialOptions override these
    let wranglerOptions: Options = {};
    // TODO: default this to wrangler.toml, see handling of .env files below
    if (this._wranglerConfigPath) {
      try {
        wranglerOptions = getWranglerOptions(
          await this._readFile(this._wranglerConfigPath),
          path.dirname(this._wranglerConfigPath),
          this._initialOptions.wranglerConfigEnv // TODO: make sure this is working
        );
      } catch (e) {
        this._log.error(
          `Unable to parse ${path.relative(
            "",
            this._wranglerConfigPath
          )}: ${e} (line: ${e.line}, col: ${e.column})`
        );
      }
    }
    // Override wrangler options with initialOptions, since these should have
    // higher priority
    const options: ProcessedOptions = {
      ...wranglerOptions,
      ...this._initialOptions,
      scripts: this._scriptBlueprints,
    };

    // Run custom build command if this is the first time we're getting options
    // to make sure the scripts exist
    if (initial && options.buildCommand) {
      await this._runCustomBuild(options.buildCommand, options.buildBasePath);
    }

    // Make sure we've got a main script
    if (options.scriptPath === undefined) {
      // TODO: consider replacing this with a more friendly error message (with help for fixing)
      throw new TypeError("No script defined");
    }
    // Resolve and load all scripts (including Durable Objects')
    if (options.scriptPath !== stringScriptPath) {
      options.scriptPath = path.resolve(options.scriptPath);
    }
    await this._addScriptBlueprint(options.scriptPath);
    // Make sure all durable objects have a scriptPath set
    options.processedDurableObjects = Object.entries(
      options.durableObjects ?? {}
    ).map(([name, details]) => {
      const className =
        typeof details === "object" ? details.className : details;
      const scriptPath =
        typeof details === "object" ? details.scriptPath : undefined;
      const resolvedScriptPath = scriptPath
        ? path.resolve(scriptPath)
        : (options.scriptPath as string);
      return {
        name,
        className,
        scriptPath: resolvedScriptPath,
      };
    });
    for (const durableObject of options.processedDurableObjects) {
      await this._addScriptBlueprint(durableObject.scriptPath);
    }

    // Parse module rules
    options.processedModulesRules = [];
    const finalisedTypes = new Set<ModuleRuleType>();
    for (const rule of [
      ...(options.modulesRules ?? []),
      ...defaultModuleRules,
    ]) {
      if (finalisedTypes.has(rule.type)) {
        // Ignore rule if type didn't enable fallthrough
        continue;
      }
      options.processedModulesRules.push({
        type: rule.type,
        include: this._globsToRegexps(rule.include),
      });
      if (!rule.fallthrough) finalisedTypes.add(rule.type);
    }
    options.modulesLinker = buildLinker(options.processedModulesRules);

    // Normalise the envPath (defaulting to .env) so we can compare it when
    // watching
    const envPathSet = options.envPath !== undefined;
    options.envPath = path.resolve(options.envPath ?? ".env");
    // Get variable bindings from envPath (only log not found if option was set)
    const envBindings = dotenv.parse(
      await this._readFile(options.envPath, envPathSet)
    );

    // Load WASM bindings
    const wasmBindings: Record<string, WebAssembly.Module> = {};
    for (const [name, wasmPath] of Object.entries(options.wasmBindings ?? {})) {
      try {
        wasmBindings[name] = new WebAssembly.Module(
          await fs.readFile(wasmPath)
        );
      } catch (e) {
        this._log.error(
          `Unable to load WASM module "${name}": ${e} (ignoring)`
        );
      }
    }

    // Rebuild bindings object taking into account priorities: envBindings and
    // wasmBindings should override wrangler, and initialOptions should override
    // everything
    // TODO: test with bindings defined in all places, make sure all set, overridden correctly
    options.bindings = {
      ...wranglerOptions.bindings,
      ...envBindings,
      ...wasmBindings,
      ...this._initialOptions.bindings,
    };

    // Parse upstream url
    try {
      options.upstreamUrl = options.upstream
        ? new URL(options.upstream)
        : undefined;
    } catch (e) {
      this._log.error(
        `Unable to parse upstream: ${e} (defaulting to no upstream)`
      );
    }

    // Parse crons
    options.validatedCrons = [];
    for (const spec of options.crons ?? []) {
      try {
        // We don't use cron.validate here since that doesn't tell us why
        // parsing failed
        const task = cron.schedule(spec, noop, { scheduled: false });
        task.destroy();
        // validateCrons is always defined here
        options.validatedCrons.push(spec);
      } catch (e) {
        this._log.error(`Unable to parse cron "${spec}": ${e} (ignoring)`);
      }
    }

    // Parse site include and exclude
    options.siteIncludeRegexps = this._globsToRegexps(options.siteInclude);
    options.siteExcludeRegexps = this._globsToRegexps(options.siteExclude);

    return options;
  }
}
