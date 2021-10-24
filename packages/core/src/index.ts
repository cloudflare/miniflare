import fs from "fs/promises";
import path from "path";
import {
  BeforeSetupResult,
  Compatibility,
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
  TypedEventTarget,
  WranglerConfig,
  addAll,
  logOptions,
} from "@miniflare/shared";
import type { Watcher } from "@miniflare/watcher";
import { dequal } from "dequal/lite";
import { dim } from "kleur/colors";
import { formatSize, pathsToString } from "./helpers";
import { BindingsPlugin, CorePlugin, populateBuildConfig } from "./plugins";
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
  withImmutableHeaders,
  withStringFormDataFiles,
} from "./standards";
import { PluginStorageFactory } from "./storage";

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

function getPluginEntries<Plugins extends PluginSignatures>(
  plugins: Plugins
): PluginEntries<Plugins> {
  // Split plugins into entries so they're easier to iterate later on.
  // Also make sure CorePlugin is always first (so other plugins can override
  // built-ins, e.g. WebSocketPlugin overriding fetch to handle WebSocket
  // upgrades), and BindingsPlugin (if included) is always last (so user can
  // override any binding/global).
  const entries = Object.entries(plugins) as PluginEntries<Plugins>;
  let coreIndex = -1;
  let bindingsIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const [, plugin] = entries[i];
    // @ts-expect-error plugin has type `typeof Plugin`
    if (plugin === CorePlugin) coreIndex = i;
    // @ts-expect-error plugin has type `typeof Plugin`
    else if (plugin === BindingsPlugin) bindingsIndex = i;
  }
  // If CorePlugin isn't already first, move it to start
  if (coreIndex > 0) {
    entries.unshift(...entries.splice(coreIndex, 1));
  }
  // If BindingsPlugin isn't already last (and it was included), move it to end
  if (bindingsIndex !== -1 && bindingsIndex !== entries.length - 1) {
    entries.push(...entries.splice(bindingsIndex, 1));
  }
  return entries;
}

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
  defaultConfigPath?: string;
}

export class ReloadEvent<Plugins extends PluginSignatures> extends Event {
  constructor(readonly plugins: PluginInstances<Plugins>) {
    super("reload");
  }
}

export type MiniflareCoreEventMap<Plugins extends PluginSignatures> = {
  reload: ReloadEvent<Plugins>;
};

export class MiniflareCore<
  Plugins extends CorePluginSignatures
> extends TypedEventTarget<MiniflareCoreEventMap<Plugins>> {
  readonly #plugins: PluginEntries<Plugins>;
  #overrides: PluginOptions<Plugins>;
  #previousOptions?: PluginOptions<Plugins>;

  readonly log: Log;
  readonly #storage: StorageFactory;
  readonly #pluginStorages: PluginData<Plugins, PluginStorageFactory>;
  readonly #scriptRunner: ScriptRunner;
  readonly #scriptRequired?: boolean;
  readonly #defaultConfigPath: string;

  #compat?: Compatibility;
  #instances?: PluginInstances<Plugins>;

  #wranglerConfigPath?: string;
  #watching?: boolean;
  #beforeSetupWatch?: PluginData<Plugins, Set<string>>;
  #setupWatch?: PluginData<Plugins, Set<string>>;
  #setupResults?: PluginData<Plugins, SetupResult>;
  #script?: ScriptBlueprint;

  #globalScope?: ServiceWorkerGlobalScope;
  #watcher?: Watcher;
  #watcherCallbackMutex?: Mutex;
  #previousWatchPaths?: Set<string>;

  constructor(
    plugins: Plugins,
    ctx: MiniflareCoreContext,
    options: Options<Plugins> = {} as Options<Plugins>
  ) {
    super();
    this.#plugins = getPluginEntries(plugins);
    this.#overrides = splitPluginOptions(this.#plugins, options);

    this.log = ctx.log;
    this.#storage = ctx.storageFactory;
    this.#pluginStorages = new Map<keyof Plugins, PluginStorageFactory>();
    this.#scriptRunner = ctx.scriptRunner;
    this.#scriptRequired = ctx.scriptRequired;
    this.#defaultConfigPath = ctx.defaultConfigPath ?? "wrangler.toml";

    this.#initPromise = this.#init().then(() => this.#reload());
  }

  #updateWatch(
    data: PluginData<Plugins, Set<string>>,
    name: keyof Plugins,
    result: BeforeSetupResult | void
  ): void {
    if (this.#watching && result?.watch) {
      const resolved = result.watch.map(pathResolve);
      data.set(name, new Set(resolved));
    } else {
      data.delete(name);
    }
  }

  async #runBeforeSetup(name: keyof Plugins): Promise<boolean> {
    const instance = this.#instances![name];
    if (!instance.beforeSetup) return false;
    this.log.verbose(`- beforeSetup(${name})`);
    const result = await instance.beforeSetup();
    this.#updateWatch(this.#beforeSetupWatch!, name, result);
    return true;
  }

  async #runSetup(name: keyof Plugins): Promise<boolean> {
    const instance = this.#instances![name];
    if (!instance.setup) return false;
    this.log.verbose(`- setup(${name})`);
    const result = await instance.setup(this.getPluginStorage(name));
    this.#updateWatch(this.#setupWatch!, name, result);
    this.#setupResults!.set(name, {
      globals: result?.globals,
      bindings: result?.bindings,
      script: result?.script,
    });
    return true;
  }

  readonly #initPromise: Promise<void>;
  async #init(): Promise<void> {
    this.log.debug("Initialising worker...");

    // Get required options
    const previous = this.#previousOptions;
    let options = this.#overrides;

    // Merge in wrangler config if defined
    const originalConfigPath = options.CorePlugin.wranglerConfigPath;
    const configEnv = options.CorePlugin.wranglerConfigEnv;
    let configPath =
      originalConfigPath === true
        ? this.#defaultConfigPath
        : originalConfigPath;
    if (configPath) {
      configPath = path.resolve(configPath);
      this.#wranglerConfigPath = configPath;
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
        populateBuildConfig(config, configDir);

        options = splitWranglerConfig(
          this.#plugins,
          this.#overrides,
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
    this.#watching ??= options.CorePlugin.watch ?? false;

    // Build compatibility manager, rebuild all plugins if compatibility data
    // has changed
    const { compatibilityDate, compatibilityFlags } = options.CorePlugin;
    let compatUpdate = false;
    if (this.#compat) {
      compatUpdate = this.#compat.update(compatibilityDate, compatibilityFlags);
    } else {
      this.#compat = new Compatibility(compatibilityDate, compatibilityFlags);
    }

    // Create plugin instances and run beforeSetup hooks, recreating any plugins
    // with changed options
    this.#instances ??= {} as PluginInstances<Plugins>;
    this.#beforeSetupWatch ??= new Map<keyof Plugins, Set<string>>();
    let ranBeforeSetup = false;
    for (const [name, plugin] of this.#plugins) {
      if (
        previous !== undefined &&
        !compatUpdate &&
        dequal(previous[name], options[name])
      ) {
        continue;
      }

      // If we have an existing instance, run its cleanup first
      const existingInstance = this.#instances[name];
      if (existingInstance?.dispose) {
        this.log.verbose(`- dispose(${name})`);
        await existingInstance.dispose();
      }

      const instance = new plugin(this.log, this.#compat, options[name]);
      this.#instances[name] = instance as any;
      if (await this.#runBeforeSetup(name)) ranBeforeSetup = true;
    }

    // Run setup hooks for (re)created plugins
    this.#setupWatch ??= new Map<keyof Plugins, Set<string>>();
    this.#setupResults ??= new Map<keyof Plugins, SetupResult>();
    for (const [name] of this.#plugins) {
      if (
        previous !== undefined &&
        !compatUpdate &&
        dequal(previous[name], options[name]) &&
        // Make sure if we ran any beforeSetups and this plugin previously
        // returned scripts, that we rerun its setup
        !(ranBeforeSetup && this.#setupResults.get(name)?.script)
      ) {
        continue;
      }

      await this.#runSetup(name);
    }

    // Store previous options so we can diff them later when wrangler config
    // changes
    this.#previousOptions = options;

    // Make sure we've got a script if it's required
    if (this.#scriptRequired && !this.#setupResults.get("CorePlugin")?.script) {
      throwNoScriptError(options.CorePlugin.modules);
    }

    // Log options every time they might've changed
    logOptions(this.#plugins, this.log, options);
  }

  async #reload(): Promise<void> {
    this.log.debug("Reloading worker...");

    const globals: Context = {};
    const bindings: Context = {};

    const newWatchPaths = new Set<string>();
    if (this.#wranglerConfigPath) newWatchPaths.add(this.#wranglerConfigPath);

    this.#script = undefined;
    for (const [name] of this.#plugins) {
      // Run beforeReload hook
      const instance = this.#instances![name];
      if (instance.beforeReload) {
        this.log.verbose(`- beforeReload(${name})`);
        await instance.beforeReload();
      }

      // Build global scope and extract script blueprints
      const result = this.#setupResults!.get(name);
      Object.assign(globals, result?.globals);
      Object.assign(bindings, result?.bindings);
      if (result?.script) {
        if (this.#script) {
          throw new TypeError("Multiple plugins returned a script");
        }
        this.#script = result.script;
      }

      // Extract watch paths
      const beforeSetupWatch = this.#beforeSetupWatch!.get(name);
      if (beforeSetupWatch) addAll(newWatchPaths, beforeSetupWatch);
      const setupWatch = this.#setupWatch!.get(name);
      if (setupWatch) addAll(newWatchPaths, setupWatch);
    }
    const { modules, processedModuleRules } = this.#instances!.CorePlugin;
    const globalScope = new ServiceWorkerGlobalScope(
      this.log,
      globals,
      bindings,
      modules
    );
    this.#globalScope = globalScope;

    // Run script blueprints, with modules rules if in modules mode
    const rules = modules ? processedModuleRules : undefined;
    const res =
      this.#script &&
      (await this.#scriptRunner.run(globalScope, this.#script, rules));
    if (res?.watch) addAll(newWatchPaths, res.watch);

    // Add module event listeners if any
    if (res?.exports) {
      const defaults = res.exports.default;

      const fetchListener = defaults?.fetch?.bind(defaults);
      if (fetchListener) {
        globalScope[kAddModuleFetchListener](fetchListener);
      }

      const scheduledListener = defaults?.scheduled?.bind(defaults);
      if (scheduledListener) {
        globalScope[kAddModuleScheduledListener](scheduledListener);
      }
    }

    // Run reload hooks
    for (const [name] of this.#plugins) {
      const instance = this.#instances![name];
      if (instance.reload) {
        this.log.verbose(`- reload(${name})`);
        await instance.reload(res?.exports ?? {}, bindings);
      }
    }
    // Dispatch reload event
    this.dispatchEvent(new ReloadEvent(this.#instances!));

    // Log bundle size and warning if too big
    this.log.info(
      `Worker reloaded!${
        res?.bundleSize !== undefined ? ` (${formatSize(res.bundleSize)})` : ""
      }`
    );
    // TODO (someday): compress asynchronously
    if (res?.bundleSize !== undefined && res.bundleSize > 1_048_576) {
      this.log.warn(
        "Worker's uncompressed size exceeds the 1MiB limit! " +
          "Note that your worker will be compressed during upload " +
          "so you may still be able to deploy it."
      );
    }

    // Update watched paths if watching
    if (this.#watching) {
      let watcher = this.#watcher;
      // Make sure we've created the watcher
      if (!watcher) {
        const { Watcher } = await import("@miniflare/watcher");
        this.#watcherCallbackMutex = new Mutex();
        watcher = new Watcher(this.#watcherCallback.bind(this)); // , this.log
        this.#watcher = watcher;
      }

      // Store changed paths
      const unwatchedPaths = new Set<string>();
      const watchedPaths = new Set<string>();
      // Unwatch paths that should no longer be watched
      for (const watchedPath of this.#previousWatchPaths ?? []) {
        if (!newWatchPaths.has(watchedPath)) {
          unwatchedPaths.add(watchedPath);
        }
      }
      // Watch paths that should now be watched
      for (const newWatchedPath of newWatchPaths) {
        if (!this.#previousWatchPaths?.has(newWatchedPath)) {
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
        await watcher.watch(watchedPaths);
      }
      this.#previousWatchPaths = newWatchPaths;
    }
  }

  #ignoreScriptUpdates = false;
  #ignoreScriptUpdatesTimeout!: NodeJS.Timeout;
  #watcherCallback(eventPath: string): void {
    this.log.debug(`${path.relative("", eventPath)} changed...`);
    if (this.#ignoreScriptUpdates && eventPath === this.#script?.filePath) {
      this.log.verbose("Ignoring script change after build...");
      return;
    }

    const promise = this.#watcherCallbackMutex!.runWith(async () => {
      // If wrangler config changed, re-init any changed plugins
      if (eventPath === this.#wranglerConfigPath) {
        await this.#init();
      }

      // Re-run hooks that returned the paths to watch originally
      let ranBeforeSetup = false;
      for (const [name] of this.#plugins) {
        if (this.#beforeSetupWatch!.get(name)?.has(eventPath)) {
          await this.#runBeforeSetup(name);
          ranBeforeSetup = true;

          // Ignore script updates for 1s
          this.#ignoreScriptUpdates = true;
          clearTimeout(this.#ignoreScriptUpdatesTimeout);
          this.#ignoreScriptUpdatesTimeout = setTimeout(
            () => (this.#ignoreScriptUpdates = false),
            1000
          );
        }
        if (this.#setupWatch!.get(name)?.has(eventPath)) {
          await this.#runSetup(name);
        }
      }

      if (ranBeforeSetup) {
        // If we ran any beforeSetup hooks, rerun setup hooks for any plugins
        // that returned scripts
        for (const [name] of this.#plugins) {
          if (this.#setupResults!.get(name)?.script) {
            await this.#runSetup(name);
          }
        }
      }

      // If the eventPath wasn't the wrangler config or from any plugins, it's
      // probably a linked module we picked up when running the script. In that
      // case, just reloading will re-read it so we don't need to do anything.

      // Wait until we've processed all changes before reloading
      if (!this.#watcherCallbackMutex!.hasWaiting) {
        await this.#reload();
      }
    });
    promise.catch((e) => this.log.error(e));
  }

  async reload(): Promise<void> {
    await this.#initPromise;
    await this.#init();
    await this.#reload();
  }

  async setOptions(options: Options<Plugins>): Promise<void> {
    await this.#initPromise;
    this.#overrides = splitPluginOptions(this.#plugins, options);
    await this.#init();
    await this.#reload();
  }

  getPluginStorage(name: keyof Plugins): StorageFactory {
    let storage = this.#pluginStorages.get(name);
    if (storage) return storage;
    this.#pluginStorages.set(
      name,
      (storage = new PluginStorageFactory(this.#storage, name as string))
    );
    return storage;
  }

  async getPlugins(): Promise<PluginInstances<Plugins>> {
    await this.#initPromise;
    return this.#instances!;
  }

  async getGlobalScope(): Promise<Context> {
    await this.#initPromise;
    return this.#globalScope!;
  }

  async dispatchFetch<WaitUntil extends any[] = unknown[]>(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<Response<WaitUntil>> {
    await this.#initPromise;
    const corePlugin = this.#instances!.CorePlugin;
    const globalScope = this.#globalScope;
    // noinspection SuspiciousTypeOfGuard
    let request =
      input instanceof Request && !init ? input : new Request(input, init);
    if (!this.#compat!.isEnabled("formdata_parser_supports_files")) {
      request = withStringFormDataFiles(request);
    }
    return globalScope![kDispatchFetch]<WaitUntil>(
      withImmutableHeaders(request),
      !!corePlugin.upstream
    );
  }

  async dispatchScheduled<WaitUntil extends any[] = unknown[]>(
    scheduledTime?: number,
    cron?: string
  ): Promise<WaitUntil> {
    await this.#initPromise;
    const globalScope = this.#globalScope;
    return globalScope![kDispatchScheduled]<WaitUntil>(scheduledTime, cron);
  }

  async dispose(): Promise<void> {
    // Run dispose hooks
    for (const [name] of this.#plugins) {
      const instance = this.#instances?.[name];
      if (instance?.dispose) {
        this.log.verbose(`- dispose(${name})`);
        await instance.dispose();
      }
    }
    // Dispose of watcher
    this.#watcher?.dispose();
  }
}
