import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import {
  BeforeSetupResult,
  Context,
  Log,
  Mutex,
  Options,
  PluginEntries,
  PluginOptions,
  PluginOptionsUnion,
  PluginSignatures,
  ScriptBlueprint,
  ScriptRunner,
  SetupResult,
  StorageFactory,
  WranglerConfig,
  logOptions,
} from "@miniflare/shared";
import type { Watcher } from "@miniflare/watcher";
import { dequal } from "dequal/lite";
import { dim } from "kleur/colors";
// @ts-expect-error we need these for making Request's Headers immutable
import fetchSymbols from "undici/lib/fetch/symbols.js";
import { addAll, formatSize, pathsToString } from "./helpers";
import { CorePlugin, autoPopulateBuildConfiguration } from "./plugins";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  ServiceWorkerGlobalScope,
  kAddModuleFetchListener,
  kAddModuleScheduledListener,
  kDispatchFetch,
  kDispatchScheduled,
} from "./standards";
import { PluginStorageFactory } from "./storage";

// TODO: don't export as much
export * from "./plugins";
export * from "./standards";
export * from "./storage";

export type CorePluginSignatures = PluginSignatures & {
  CorePlugin: typeof CorePlugin;
};

export type PluginInstances<Plugins extends PluginSignatures> = {
  [K in keyof Plugins]: InstanceType<Plugins[K]>;
};

type PluginData<Plugins extends PluginSignatures, Data> = Map<
  keyof Plugins,
  Data
>;

export type ReloadListener<Plugins extends PluginSignatures> = (
  plugins: PluginInstances<Plugins>
) => void;

function splitPluginOptions<Plugins extends PluginSignatures>(
  plugins: PluginEntries<Plugins>,
  options: Options<Plugins>
): PluginOptions<Plugins> {
  const result = {} as PluginOptions<Plugins>;
  for (const [name, plugin] of plugins) {
    const pluginResult = {} as PluginOptionsUnion<Plugins>;
    for (const key of plugin.prototype.opts?.keys() ?? []) {
      // Only include defined keys, otherwise all options defined in Wrangler
      // config would be unset
      if (key in (options as any)) {
        (pluginResult as any)[key] = (options as any)[key];
      }
    }
    result[name] = pluginResult;
  }
  return result;
}

function splitWranglerConfig<Plugins extends PluginSignatures>(
  plugins: PluginEntries<Plugins>,
  overrides: PluginOptions<Plugins>,
  config: WranglerConfig,
  configDir: string
): PluginOptions<Plugins> {
  // Create a new options object so we don't override overrides with undefined,
  // causing future reloads to unset config defined in Wrangler
  const result = {} as PluginOptions<Plugins>;
  for (const [name, plugin] of plugins) {
    const pluginResult = {} as PluginOptionsUnion<Plugins>;
    const pluginOverrides = overrides[name];
    for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
      (pluginResult as any)[key] =
        pluginOverrides[key] ?? meta.fromWrangler?.(config, configDir);
    }
    result[name] = pluginResult;
  }
  return result;
}

const pathResolve = (p: string) => path.resolve(p);

function throwNoScriptError(modules?: boolean) {
  const execName = process.env.MINIFLARE_EXEC_NAME ?? "miniflare";
  const script = modules ? "worker.mjs" : "worker.js";
  const format = modules ? "modules" : "service-worker";
  const pkgScriptField = modules ? "module" : "main";
  throw new TypeError(
    [
      "No script defined, either:",
      "- Pass it as a positional argument, if you're using the CLI",
      dim(`    $ ${execName} dist/${script}`),
      "- Set the script or scriptPath option, if you're using the API",
      dim(`    new Miniflare({ scriptPath: "dist/${script}" })`),
      "- Set build.upload.main in wrangler.toml",
      dim("    [build.upload]"),
      dim(`    format = "${format}"`),
      dim(`    dir = "dist"`),
      dim(`    main = "${script}"`),
      `- Set ${pkgScriptField} in package.json`,
      dim(`    { "${pkgScriptField}": "dist/${script}" }`),
      "",
    ].join("\n")
  );
}

export interface MiniflareCoreContext {
  log: Log;
  storageFactory: StorageFactory;
  scriptRunner: ScriptRunner;
  scriptRequired?: boolean;
}

const kPlugins = Symbol("kPlugins");
const kOverrides = Symbol("kOverrides");
const kPreviousOptions = Symbol("kPreviousOptions");

const kStorage = Symbol("kStorage");
const kPluginStorages = Symbol("kPluginStorages");
const kScriptRunner = Symbol("kScriptRunner");
const kScriptRequired = Symbol("kScriptRequired");

const kInstances = Symbol("kInstances");

const kWranglerConfigPath = Symbol("kWranglerConfigPath");
const kWatching = Symbol("kWatching");

const kRunBeforeSetup = Symbol("kRunBeforeSetup");
const kRunSetup = Symbol("kRunSetup");
const kUpdateWatch = Symbol("kUpdateWatch");
const kBeforeSetupWatch = Symbol("kBeforeSetupWatch");
const kSetupWatch = Symbol("kSetupWatch");
const kSetupResults = Symbol("kSetupResults");

const kGlobalScope = Symbol("kGlobalScope");
const kWatcher = Symbol("kWatcher");
const kWatcherCallback = Symbol("kWatcherCallback");
const kWatcherCallbackMutex = Symbol("KWatcherCallbackMutex");
const kPreviousWatchPaths = Symbol("kPreviousWatchPaths");

const kReloadListeners = Symbol("kReloadListeners");

const kInitPromise = Symbol("kInitPromise");
const kInit = Symbol("kInit");
const kReload = Symbol("kReload");

export class MiniflareCore<Plugins extends CorePluginSignatures> {
  private readonly [kPlugins]: PluginEntries<Plugins>;
  private [kOverrides]: PluginOptions<Plugins>;
  private [kPreviousOptions]?: PluginOptions<Plugins>;

  readonly log: Log;
  private readonly [kStorage]: StorageFactory;
  private readonly [kPluginStorages]: PluginData<Plugins, PluginStorageFactory>;
  private readonly [kScriptRunner]: ScriptRunner;
  private readonly [kScriptRequired]?: boolean;

  private [kInstances]: PluginInstances<Plugins>;

  private [kWranglerConfigPath]?: string;
  private [kWatching]: boolean;
  private [kBeforeSetupWatch]: PluginData<Plugins, Set<string>>;
  private [kSetupWatch]: PluginData<Plugins, Set<string>>;
  private [kSetupResults]: PluginData<Plugins, SetupResult>;

  private [kGlobalScope]: ServiceWorkerGlobalScope;
  private [kWatcher]?: Watcher;
  private [kWatcherCallbackMutex]: Mutex;
  private [kPreviousWatchPaths]?: Set<string>;

  private readonly [kReloadListeners] = new Set<ReloadListener<Plugins>>();

  constructor(
    plugins: Plugins,
    ctx: MiniflareCoreContext,
    options: Options<Plugins> = {} as Options<Plugins>
  ) {
    this[kPlugins] = Object.entries({ ...plugins, CorePlugin }) as any;
    this[kOverrides] = splitPluginOptions(this[kPlugins], options);

    this.log = ctx.log;
    this[kStorage] = ctx.storageFactory;
    this[kPluginStorages] = new Map<keyof Plugins, PluginStorageFactory>();
    this[kScriptRunner] = ctx.scriptRunner;
    this[kScriptRequired] = ctx.scriptRequired;

    this[kInitPromise] = this[kInit]().then(() => this[kReload]());
  }

  private [kUpdateWatch](
    data: PluginData<Plugins, Set<string>>,
    name: keyof Plugins,
    result: BeforeSetupResult | void
  ): void {
    if (this[kWatching] && result?.watch) {
      const resolved = result.watch.map(pathResolve);
      data.set(name, new Set(resolved));
    } else {
      data.delete(name);
    }
  }

  private async [kRunBeforeSetup](name: keyof Plugins): Promise<void> {
    const instance = this[kInstances][name];
    if (!instance.beforeSetup) return;
    this.log.verbose(`- beforeSetup(${name})`);
    const result = await instance.beforeSetup();
    this[kUpdateWatch](this[kBeforeSetupWatch], name, result);
  }

  private async [kRunSetup](name: keyof Plugins): Promise<void> {
    const instance = this[kInstances][name];
    if (!instance.setup) return;
    this.log.verbose(`- setup(${name})`);
    const result = await instance.setup(this.getPluginStorage(name));
    this[kUpdateWatch](this[kSetupWatch], name, result);
    this[kSetupResults].set(name, {
      globals: result?.globals,
      bindings: result?.bindings,
      scripts: result?.scripts,
    });
  }

  private readonly [kInitPromise]: Promise<void>;
  private async [kInit](): Promise<void> {
    this.log.debug("Initialising worker...");

    // Get required options
    const previous = this[kPreviousOptions];
    let options = this[kOverrides];

    // Merge in wrangler config if defined
    const originalConfigPath = options.CorePlugin.wranglerConfigPath;
    const configEnv = options.CorePlugin.wranglerConfigEnv;
    let configPath =
      originalConfigPath === true ? "wrangler.toml" : originalConfigPath;
    if (configPath) {
      configPath = path.resolve(configPath);
      this[kWranglerConfigPath] = configPath;
      try {
        const configData = await fs.readFile(configPath, "utf8");
        const toml = await import("@iarna/toml");
        const config: WranglerConfig = toml.parse(configData);
        if (configEnv && config.env && configEnv in config.env) {
          // TODO: take into account option inheritance properly
          Object.assign(config, config.env[configEnv]);
        }
        const configDir = path.dirname(configPath);

        // Add build configuration for webpack and rust builds
        autoPopulateBuildConfiguration(config, configDir);

        options = splitWranglerConfig(
          this[kPlugins],
          this[kOverrides],
          config,
          configDir
        );
      } catch (e: any) {
        // Ignore ENOENT (file not found) errors for default path
        if (!(e.code === "ENOENT" && originalConfigPath === true)) {
          throw e;
        }
      }
    }
    // Store the watching option for the first init only. We don't want to stop
    // watching if the user changes the watch option in wrangler config mid-way
    // through execution. (NOTE: ??= will only assign on undefined, not false)
    this[kWatching] ??= options.CorePlugin.watch ?? false;

    // Create plugin instances and run beforeSetup hooks, recreating any plugins
    // with changed options
    this[kInstances] ??= {} as PluginInstances<Plugins>;
    this[kBeforeSetupWatch] ??= new Map<keyof Plugins, Set<string>>();
    let ranBeforeSetup = false;
    for (const [name, plugin] of this[kPlugins]) {
      if (previous !== undefined && dequal(previous[name], options[name])) {
        continue;
      }

      // If we have an existing instance, run its cleanup first
      const existingInstance = this[kInstances][name];
      if (existingInstance?.dispose) {
        this.log.verbose(`- dispose(${name})`);
        await existingInstance.dispose();
      }

      const instance = new plugin(this.log, options[name]);
      this[kInstances][name] = instance as any;
      await this[kRunBeforeSetup](name);
      ranBeforeSetup = true;
    }

    // Run setup hooks for (re)created plugins
    this[kSetupWatch] ??= new Map<keyof Plugins, Set<string>>();
    this[kSetupResults] ??= new Map<keyof Plugins, SetupResult>();
    for (const [name] of this[kPlugins]) {
      if (
        previous !== undefined &&
        dequal(previous[name], options[name]) &&
        // Make sure if we ran any beforeSetups and this plugin previously
        // returned scripts, that we rerun its setup
        !(ranBeforeSetup && this[kSetupResults].get(name)?.scripts?.length)
      ) {
        continue;
      }

      await this[kRunSetup](name);
    }

    // Store previous options so we can diff them later when wrangler config
    // changes
    this[kPreviousOptions] = options;

    // Make sure we've got a script if it's required
    if (this[kScriptRequired] && !this[kInstances].CorePlugin.mainScriptPath) {
      throwNoScriptError(options.CorePlugin.modules);
    }

    // Log options every time they might've changed
    logOptions(this[kPlugins], this.log, options);
  }

  private async [kReload](): Promise<void> {
    this.log.debug("Reloading worker...");

    const globals: Context = {};
    const bindings: Context = {};
    const blueprints: ScriptBlueprint[] = [];

    const newWatchPaths = new Set<string>();
    const configPath = this[kWranglerConfigPath];
    if (configPath) newWatchPaths.add(configPath);

    for (const [name] of this[kPlugins]) {
      // Run beforeReload hook
      const instance = this[kInstances][name];
      if (instance.beforeReload) {
        this.log.verbose(`- beforeReload(${name})`);
        await instance.beforeReload();
      }

      // Build global scope and extract script blueprints
      const result = this[kSetupResults].get(name);
      Object.assign(globals, result?.globals);
      Object.assign(bindings, result?.bindings);
      if (result?.scripts) blueprints.push(...result.scripts);

      // Extract watch paths
      const beforeSetupWatch = this[kBeforeSetupWatch].get(name);
      if (beforeSetupWatch) addAll(newWatchPaths, beforeSetupWatch);
      const setupWatch = this[kSetupWatch].get(name);
      if (setupWatch) addAll(newWatchPaths, setupWatch);
    }
    const { modules, processedModuleRules, mainScriptPath } =
      this[kInstances].CorePlugin;
    const globalScope = new ServiceWorkerGlobalScope(
      this.log,
      globals,
      bindings,
      modules
    );
    this[kGlobalScope] = globalScope;

    // Run script blueprints, with modules rules if in modules mode
    const rules = modules ? processedModuleRules : undefined;
    const res = await this[kScriptRunner].run(globalScope, blueprints, rules);
    if (res.watch) addAll(newWatchPaths, res.watch);

    // Add module event listeners if any
    const mainExports = mainScriptPath && res.exports.get(mainScriptPath);
    if (mainExports) {
      const fetchListener = mainExports.default?.fetch;
      if (fetchListener) {
        globalScope[kAddModuleFetchListener](fetchListener);
      }

      const scheduledListener = mainExports.default?.scheduled;
      if (scheduledListener) {
        globalScope[kAddModuleScheduledListener](scheduledListener);
      }
    }

    // Run reload hooks
    for (const [name] of this[kPlugins]) {
      const instance = this[kInstances][name];
      if (instance.reload) {
        this.log.verbose(`- reload(${name})`);
        await instance.reload(res.exports, bindings, mainScriptPath);
      }
    }
    // Run reload listeners
    for (const listener of this[kReloadListeners]) listener(this[kInstances]);

    // Log bundle size and warning if too big
    this.log.info(
      `Worker reloaded!${
        res.bundleSize !== undefined ? ` (${formatSize(res.bundleSize)})` : ""
      }`
    );
    // TODO: compress asynchronously
    if (res.bundleSize !== undefined && res.bundleSize > 1_048_576) {
      this.log.warn(
        "Worker's uncompressed size exceeds the 1MiB limit!" +
          "Note that your worker will be compressed during upload " +
          "so you may still be able to deploy it."
      );
    }

    // Update watched paths if watching
    if (this[kWatching]) {
      let watcher = this[kWatcher];
      // Make sure we've created the watcher
      if (!watcher) {
        const { Watcher } = await import("@miniflare/watcher");
        this[kWatcherCallbackMutex] = new Mutex();
        watcher = new Watcher(this[kWatcherCallback].bind(this), this.log);
        this[kWatcher] = watcher;
      }

      // Store changed paths
      const unwatchedPaths = new Set<string>();
      const watchedPaths = new Set<string>();
      // Unwatch paths that should no longer be watched
      for (const watchedPath of this[kPreviousWatchPaths] ?? []) {
        if (!newWatchPaths.has(watchedPath)) {
          unwatchedPaths.add(watchedPath);
        }
      }
      // Watch paths that should now be watched
      for (const newWatchedPath of newWatchPaths) {
        if (!this[kPreviousWatchPaths]?.has(newWatchedPath)) {
          watchedPaths.add(newWatchedPath);
        }
      }
      // Apply and log changes
      if (unwatchedPaths.size > 0) {
        this.log.debug(`Unwatching ${pathsToString(unwatchedPaths)}...`);
        watcher.unwatch(unwatchedPaths);
      }
      if (watchedPaths.size > 0) {
        this.log.debug(`Watching ${pathsToString(newWatchPaths)}...`);
        watcher.watch(watchedPaths);
      }
      this[kPreviousWatchPaths] = newWatchPaths;
    }
  }

  private [kWatcherCallback](eventPath: string): void {
    this.log.debug(`${path.relative("", eventPath)} changed...`);
    const promise = this[kWatcherCallbackMutex].runWith(async () => {
      // If wrangler config changed, re-init any changed plugins
      if (eventPath === this[kWranglerConfigPath]) {
        await this[kInit]();
      }

      // Re-run hooks that returned the paths to watch originally
      let ranBeforeSetup = false;
      for (const [name] of this[kPlugins]) {
        if (this[kBeforeSetupWatch].get(name)?.has(eventPath)) {
          await this[kRunBeforeSetup](name);
          ranBeforeSetup = true;
        }
        if (this[kSetupWatch].get(name)?.has(eventPath)) {
          await this[kRunSetup](name);
        }
      }

      if (ranBeforeSetup) {
        // If we ran any beforeSetup hooks, rerun setup hooks for any plugins
        // that returned scripts
        for (const [name] of this[kPlugins]) {
          if (this[kSetupResults].get(name)?.scripts?.length) {
            await this[kRunSetup](name);
          }
        }
      }

      // If the eventPath wasn't the wrangler config or from any plugins, it's
      // probably a linked module we picked up when running the script. In that
      // case, just reloading will re-read it so we don't need to do anything.

      // Wait until we've processed all changes before reloading
      if (!this[kWatcherCallbackMutex].hasWaiting) {
        await this[kReload]();
      }
    });
    promise.catch((e) => this.log.error(e));
  }

  async reload(): Promise<void> {
    await this[kInitPromise];
    await this[kInit]();
    await this[kReload]();
  }

  // TODO: event target?

  addReloadListener(listener: ReloadListener<Plugins>): void {
    this[kReloadListeners].add(listener);
  }

  removeReloadListener(listener: ReloadListener<Plugins>): void {
    this[kReloadListeners].delete(listener);
  }

  async setOptions(options: Options<Plugins>): Promise<void> {
    await this[kInitPromise];
    this[kOverrides] = splitPluginOptions(this[kPlugins], options);
    await this[kInit]();
    await this[kReload]();
  }

  getPluginStorage(name: keyof Plugins): PluginStorageFactory {
    let storage = this[kPluginStorages].get(name);
    if (storage) return storage;
    this[kPluginStorages].set(
      name,
      (storage = new PluginStorageFactory(this[kStorage], name as string))
    );
    return storage;
  }

  async getPlugins(): Promise<PluginInstances<Plugins>> {
    await this[kInitPromise];
    assert(this[kInstances]);
    return this[kInstances];
  }

  async getGlobalScope(): Promise<Context> {
    await this[kInitPromise];
    assert(this[kGlobalScope]);
    return this[kGlobalScope];
  }

  async dispatchFetch<WaitUntil extends any[] = unknown[]>(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<Response<WaitUntil>> {
    await this[kInitPromise];
    const corePlugin = this[kInstances].CorePlugin;
    const globalScope = this[kGlobalScope];
    assert(corePlugin && globalScope);
    const request =
      input instanceof Request && !init ? input : new Request(input, init);
    // @ts-expect-error internal kGuard isn't included in type definitions
    request.headers[fetchSymbols.kGuard] = "immutable";
    return globalScope[kDispatchFetch]<WaitUntil>(
      request,
      !!corePlugin.upstream
    );
  }

  async dispatchScheduled<WaitUntil extends any[] = unknown[]>(
    scheduledTime?: number,
    cron?: string
  ): Promise<WaitUntil> {
    await this[kInitPromise];
    const globalScope = this[kGlobalScope];
    assert(globalScope);
    return globalScope[kDispatchScheduled]<WaitUntil>(scheduledTime, cron);
  }

  async dispose(): Promise<void> {
    // Run dispose hooks
    for (const [name] of this[kPlugins]) {
      const instance = this[kInstances][name];
      if (instance.dispose) {
        this.log.verbose(`- dispose(${name})`);
        await instance.dispose();
      }
    }
  }
}
