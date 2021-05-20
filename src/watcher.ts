import { promises as fs } from "fs";
import path from "path";
import { URL } from "url";
import vm from "vm";
import chokidar from "chokidar";
import dotenv from "dotenv";
import match from "minimatch";
import cron from "node-cron";
import { Log } from "./log";
import { Options, ProcessedOptions, logOptions } from "./options";
import { getWranglerOptions } from "./options/wrangler";

const noop = () => {};
const minimatchOptions: match.IOptions = { nocomment: true };

export type WatchCallback = (
  script: vm.Script,
  options: ProcessedOptions,
  optionsKey: number
) => void;

export class Watcher {
  private readonly _log: Log;
  private readonly _callback: WatchCallback;

  private readonly _initialOptions: Options;
  private readonly _wranglerConfigPath?: string;

  private _script?: vm.Script;
  private _scriptPath?: string;
  private _options?: ProcessedOptions;
  private _optionsKey: number;

  private readonly _initPromise: Promise<void>;
  private _watcher?: chokidar.FSWatcher;
  private _watchedEnvPath?: string;

  constructor(
    log: Log,
    callback: WatchCallback,
    scriptDescriptor: vm.Script | string,
    options: Options
  ) {
    this._log = log;
    this._callback = callback;

    // Set initial options
    this._initialOptions = options;
    this._wranglerConfigPath = options.wranglerConfigPath
      ? path.resolve(options.wranglerConfigPath)
      : undefined;

    this._optionsKey = 0;
    this._initPromise = this._init(scriptDescriptor);
  }

  private async _init(scriptDescriptor: vm.Script | string): Promise<void> {
    // Yield initial values
    if (scriptDescriptor instanceof vm.Script) {
      this._script = scriptDescriptor;
    } else {
      // Normalise the scriptPath so we can compare it when watching
      this._scriptPath = path.resolve(scriptDescriptor);
      this._script = await this._getScript();
    }
    this._options = await this._getOptions();
    this._callback(this._script, this._options, this._optionsKey);

    // Stop here if we're not watching files
    if (!this._options.watch) return;

    // Get an array of watched file paths, storing the watchedEnvPath explicitly
    // so we can tell if it changes later
    this._watchedEnvPath = this._options.envPath;
    const watchPaths = [];
    if (this._scriptPath) watchPaths.push(this._scriptPath);
    if (this._wranglerConfigPath) watchPaths.push(this._wranglerConfigPath);
    if (this._options.envPath) watchPaths.push(this._options.envPath);
    this._log.debug(
      `Watching ${watchPaths
        .map((filePath) => path.basename(filePath))
        .join(", ")}...`
    );

    // Create watcher
    const boundCallback = this._watchedPathCallback.bind(this);
    this._watcher = chokidar
      .watch(watchPaths)
      .on("change", boundCallback)
      .on("unlink", boundCallback);
  }

  private async _watchedPathCallback(eventPath: string) {
    if (eventPath === this._scriptPath) {
      // If the script changed, reload it from disk
      this._log.debug(
        `${path.basename(eventPath)} changed, reloading script...`
      );
      await this.reloadScript();
    } else if (
      eventPath === this._wranglerConfigPath ||
      eventPath === this._watchedEnvPath
    ) {
      // If either the wrangler config or the env file changed, reload the
      // options from disk, taking into account the initialOptions
      this._log.debug(
        `${path.basename(eventPath)} changed, reloading options...`
      );
      await this.reloadOptions();
    }
  }

  async reloadScript(): Promise<void> {
    await this._initPromise;
    if (!this._scriptPath) {
      this._log.warn("reloadScript() called without a script path set");
      return;
    }
    this._script = await this._getScript();
    if (this._options === undefined) {
      // This should never happen: _options is set in _init which we've awaited
      throw new TypeError("reloadScript() requires this._options");
    }
    this._callback(this._script, this._options, this._optionsKey);
  }

  async reloadOptions(): Promise<void> {
    await this._initPromise;
    const options = await this._getOptions();

    // If the envPath changed, switch the path we're watching (if we even are)
    if (this._watcher && options.envPath !== this._watchedEnvPath) {
      if (this._watchedEnvPath !== undefined) {
        this._log.debug(`Unwatching ${path.basename(this._watchedEnvPath)}...`);
        this._watcher.unwatch(this._watchedEnvPath);
      }
      if (options.envPath !== undefined) {
        this._log.debug(`Watching ${path.basename(options.envPath)}...`);
        this._watcher.add(options.envPath);
      }
      this._watchedEnvPath = options.envPath;
    }

    this._options = options;
    // Change the optionsKey so we know to rebuild the sandbox
    this._optionsKey++;
    if (this._script === undefined) {
      // This should never happen: _script is set in _init which we've awaited
      throw new TypeError("reloadOptions() requires this._script");
    }
    this._callback(this._script, options, this._optionsKey);
  }

  private async _readFile(filePath: string, logError = true): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (e) {
      if (logError) {
        this._log.error(
          `Unable to read ${path.basename(
            filePath
          )}: ${e} (defaulting to empty string)`
        );
      }
      return "";
    }
  }

  private async _getScript(): Promise<vm.Script> {
    if (this._scriptPath === undefined) {
      throw new TypeError("_getScript() requires this._scriptPath");
    }
    // Read file contents and create script object
    const code = await this._readFile(this._scriptPath);
    try {
      return new vm.Script(code, { filename: this._scriptPath });
    } catch (e) {
      this._log.error(
        `Unable to parse ${path.basename(this._scriptPath)}: ${e}`
      );
      return new vm.Script("");
    }
  }

  private _globsToRegexps(globs?: string[]): RegExp[] {
    const regexps: RegExp[] = [];
    for (const glob of globs ?? []) {
      const regexp = match.makeRe(glob, minimatchOptions) as RegExp | false;
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

  private async _getOptions(): Promise<ProcessedOptions> {
    // Get wrangler options first (if set) since initialOptions override these
    let wranglerOptions: Options = {};
    if (this._wranglerConfigPath) {
      try {
        wranglerOptions = getWranglerOptions(
          await this._readFile(this._wranglerConfigPath),
          this._initialOptions.wranglerConfigEnv // TODO: make sure this is working
        );
      } catch (e) {
        this._log.error(
          `Unable to parse ${path.basename(
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
      validatedCrons: [],
      siteIncludeRegexps: [],
      siteExcludeRegexps: [],
    };
    // Normalise the envPath (defaulting to .env) so we can compare it when
    // watching
    const envPathSet = options.envPath !== undefined;
    options.envPath = path.resolve(options.envPath ?? ".env");
    // Get variable bindings from envPath (only log not found if option was set)
    const envBindings = dotenv.parse(
      await this._readFile(options.envPath, envPathSet)
    );
    // Rebuild bindings object taking into account priorities: envBindings
    // should override wrangler and initialOptions should override everything
    // TODO: test with bindings defined in all places, make sure all set, overridden correctly
    options.bindings = {
      ...wranglerOptions.bindings,
      ...envBindings,
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
    for (const spec of options.crons ?? []) {
      try {
        // We don't use cron.validate here since that doesn't tell us why
        // parsing failed
        const task = cron.schedule(spec, noop, { scheduled: false });
        task.destroy();
        // validateCrons is always defined here
        options.validatedCrons?.push(spec);
      } catch (e) {
        this._log.error(`Unable to parse cron "${spec}": ${e} (ignoring)`);
      }
    }

    // Parse site include and exclude
    options.siteIncludeRegexps = this._globsToRegexps(options.siteInclude);
    options.siteExcludeRegexps = this._globsToRegexps(options.siteExclude);

    // Log processed options
    logOptions(this._log, options);
    return options;
  }
}
