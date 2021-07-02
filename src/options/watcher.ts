import path from "path";
import chokidar from "chokidar";
import { Log } from "../log";
import { OptionsProcessor } from "./processor";
import { Options, ProcessedOptions, logOptions } from "./index";

function pathSetToString(set: Set<string>): string {
  return [...set]
    .map((filePath) => path.relative("", filePath))
    .sort()
    .join(", ");
}

export type OptionsWatchCallback = (options: ProcessedOptions) => void;

export class OptionsWatcher {
  private _processor: OptionsProcessor;
  private _options?: ProcessedOptions;

  private _watcher?: chokidar.FSWatcher;
  private _watchedPaths?: Set<string>;
  private _extraWatchedPaths?: Set<string>;

  constructor(
    private log: Log,
    private callback: OptionsWatchCallback,
    private initialOptions: Options
  ) {
    this._processor = new OptionsProcessor(log, initialOptions);

    // Setup initial options
    void this._init();
  }

  private _getWatchedPaths(): Set<string> {
    const watchedPaths = new Set<string>(this._extraWatchedPaths);
    watchedPaths.add(this._processor.wranglerConfigPath);
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

  private _updateWatchedPaths(): void {
    // Update watched paths only if we're watching files
    if (this._watcher && this._watchedPaths) {
      // Store changed paths for logging
      const unwatchedPaths = new Set<string>();
      const watchedPaths = new Set<string>();

      const newWatchedPaths = this._getWatchedPaths();
      // Unwatch paths that should no longer be watched
      for (const watchedPath of this._watchedPaths) {
        if (!newWatchedPaths.has(watchedPath)) {
          unwatchedPaths.add(watchedPath);
          this._watcher.unwatch(watchedPath);
        }
      }
      // Watch paths that should now be watched
      for (const newWatchedPath of newWatchedPaths) {
        if (!this._watchedPaths.has(newWatchedPath)) {
          watchedPaths.add(newWatchedPath);
          this._watcher.add(newWatchedPath);
        }
      }
      this._watchedPaths = newWatchedPaths;

      if (unwatchedPaths.size > 0) {
        this.log.debug(`Unwatching ${pathSetToString(unwatchedPaths)}...`);
      }
      if (watchedPaths.size > 0) {
        this.log.debug(`Watching ${pathSetToString(watchedPaths)}...`);
      }
    }
  }

  setExtraWatchedPaths(paths?: Set<string>): void {
    this._extraWatchedPaths = paths;
    this._updateWatchedPaths();
  }

  private async _init(): Promise<void> {
    // Yield initial values
    try {
      this._options = await this._processor.getProcessedOptions(true);
      logOptions(this.log, this._options);
      this.callback(this._options);
    } catch (e) {
      this.log.error(e.stack);
    }

    // Stop here if we're not watching files
    if (!this._options?.watch) return;

    // Get an array of watched file paths, storing the watchedEnvPath explicitly
    // so we can tell if it changes later
    this._watchedPaths = this._getWatchedPaths();
    this.log.debug(`Watching ${pathSetToString(this._watchedPaths)}...`);

    // Create watcher
    const boundCallback = this._watchedPathCallback.bind(this);
    this._watcher = chokidar
      .watch([...this._watchedPaths], { ignoreInitial: true })
      .on("add", boundCallback)
      .on("change", boundCallback)
      .on("unlink", boundCallback);
  }

  private _watchedPathCallback(eventPath: string) {
    if (
      eventPath === this._processor.wranglerConfigPath ||
      eventPath === this._options?.envPath
    ) {
      // If either the wrangler config or the env file changed, reload the
      // options from disk, taking into account the initialOptions
      this.log.debug(
        `${path.relative("", eventPath)} changed, reloading options...`
      );
      void this.reloadOptions();
    } else if (
      this._options?.buildWatchPath &&
      eventPath.startsWith(this._options.buildWatchPath)
    ) {
      if (this._options.buildCommand) {
        this.log.debug(
          `${path.relative("", eventPath)} changed, rebuilding...`
        );
        // Re-run build, this should change a script triggering the watcher
        // again
        void this._processor.runCustomBuild(
          this._options.buildCommand,
          this._options.buildBasePath
        );
      }
    } else {
      // If the path isn't a config, or in buildWatchPath, it's a script or WASM
      // file, so just reload all scripts
      this.log.debug(
        `${path.relative("", eventPath)} changed, reloading scripts...`
      );
      void this.reloadScripts();
    }
  }

  async reloadScripts(): Promise<void> {
    this._processor.resetScriptBlueprints();
    await this.reloadOptions(false);
  }

  async reloadOptions(log = true): Promise<void> {
    this._options = await this._processor.getProcessedOptions();
    if (log) logOptions(this.log, this._options);
    this._updateWatchedPaths();
    this.callback(this._options);
  }

  async dispose(): Promise<void> {
    await this._watcher?.close();
  }
}
