import fs from "fs/promises";
import path from "path";
import { URL } from "url";
import { QueueBroker } from "@miniflare/queues";
import {
  AdditionalModules,
  BeforeSetupResult,
  Compatibility,
  Context,
  Log,
  MessageBatch,
  Mutex,
  Options,
  PluginContext,
  PluginEntries,
  PluginOptions,
  PluginOptionsUnion,
  PluginSignatures,
  RequestContext,
  ScriptBlueprint,
  ScriptRunner,
  ScriptRunnerResult,
  SetupResult,
  StorageFactory,
  TypedEventTarget,
  UsageModel,
  WranglerConfig,
  addAll,
  logOptions,
  resolveStoragePersist,
  usageModelExternalSubrequestLimit,
} from "@miniflare/shared";
import type { Watcher } from "@miniflare/watcher";
import { dequal } from "dequal/lite";
import { dim } from "kleur/colors";
import { MockAgent } from "undici";
import { MiniflareCoreError } from "./error";
import { formatSize, pathsToString } from "./helpers";
import {
  BindingsPlugin,
  CorePlugin,
  _CoreMount,
  _populateBuildConfig,
} from "./plugins";
import { Router } from "./router";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  ServiceWorkerGlobalScope,
  _kLoopHeader,
  kAddModuleFetchListener,
  kAddModuleQueueListener,
  kAddModuleScheduledListener,
  kDispatchFetch,
  kDispatchQueue,
  kDispatchScheduled,
  kDispose,
  withImmutableHeaders,
  withStringFormDataFiles,
} from "./standards";
import { PluginStorageFactory } from "./storage";

export * from "./plugins";
export * from "./standards";

export * from "./error";
export * from "./router";
export * from "./storage";

/** @internal */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function _deepEqual(a: any, b: any): boolean {
  if (!dequal(a, b)) return false;

  // Check top-level symbol properties are equal (used by BindingsPlugin for
  // Wrangler variables)
  if (typeof a === "object") {
    const aSymbols = Object.getOwnPropertySymbols(a);
    for (const aSymbol of aSymbols) {
      if (!(aSymbol in b) || !dequal(a[aSymbol], b[aSymbol])) return false;
    }
    return aSymbols.length === Object.getOwnPropertySymbols(b).length;
  }
  return true;
}

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

export type MiniflareCoreOptions<Plugins extends CorePluginSignatures> = Omit<
  Options<Plugins>,
  "mounts" // Replace Record<string, string | ...> from CoreOptions...
> & {
  // ...with Record that allows any options from Plugins to be specified,
  // disallowing nesting
  mounts?: Record<string, string | Omit<Options<Plugins>, "mounts">>;
};

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

function splitPluginOptions<Plugins extends CorePluginSignatures>(
  plugins: PluginEntries<Plugins>,
  options: MiniflareCoreOptions<Plugins>
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
  configDir: string,
  log: Log
): PluginOptions<Plugins> {
  // Create a new options object so we don't override overrides with undefined,
  // causing future reloads to unset config defined in Wrangler
  const result = {} as PluginOptions<Plugins>;
  for (const [name, plugin] of plugins) {
    const pluginResult = {} as PluginOptionsUnion<Plugins>;
    const pluginOverrides = overrides[name];
    for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
      // TODO: merge object options (e.g. bindings)
      // `in` check means users can pass `undefined` to unset options defined
      // in wrangler.toml
      if (key in pluginOverrides) {
        (pluginResult as any)[key] = pluginOverrides[key];
      } else {
        (pluginResult as any)[key] = meta.fromWrangler?.(
          config,
          configDir,
          log
        );
      }
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
  const lines = [
    "No script defined, either:",
    "- Pass it as a positional argument, if you're using the CLI",
    dim(`    $ ${execName} dist/${script}`),
    "- Set the script or scriptPath option, if you're using the API",
    dim(`    new Miniflare({ scriptPath: "dist/${script}" })`),
    `- Set ${pkgScriptField} in package.json`,
    dim(`    { "${pkgScriptField}": "dist/${script}" }`),
  ];
  if (modules) {
    lines.push(
      "- Set build.upload.main in wrangler.toml",
      dim("    [build.upload]"),
      dim(`    format = "${format}"`),
      dim(`    dir = "dist"`),
      dim(`    main = "${script}"`)
    );
  }
  lines.push("");
  throw new MiniflareCoreError("ERR_NO_SCRIPT", lines.join("\n"));
}

export interface MiniflareCoreContext {
  log: Log;
  storageFactory: StorageFactory;
  queueBroker: QueueBroker;
  scriptRunner?: ScriptRunner;
  scriptRequired?: boolean;
  scriptRunForModuleExports?: boolean;
  isMount?: boolean;
}

export class ReloadEvent<Plugins extends PluginSignatures> extends Event {
  readonly plugins: PluginInstances<Plugins>;
  readonly initial: boolean;

  constructor(
    type: "reload",
    init: { plugins: PluginInstances<Plugins>; initial: boolean }
  ) {
    super(type);
    this.plugins = init.plugins;
    this.initial = init.initial;
  }
}

export type MiniflareCoreEventMap<Plugins extends PluginSignatures> = {
  reload: ReloadEvent<Plugins>;
};

export class MiniflareCore<
  Plugins extends CorePluginSignatures
> extends TypedEventTarget<MiniflareCoreEventMap<Plugins>> {
  readonly #originalPlugins: Plugins;
  readonly #plugins: PluginEntries<Plugins>;
  #previousSetOptions: MiniflareCoreOptions<Plugins>;
  #overrides: PluginOptions<Plugins>;
  #previousOptions?: PluginOptions<Plugins>;

  readonly #ctx: MiniflareCoreContext;
  readonly #pluginStorages: PluginData<Plugins, PluginStorageFactory>;

  #compat?: Compatibility;
  #previousRootPath?: string;
  #previousUsageModel?: UsageModel;
  #previousGlobalAsyncIO?: boolean;
  #instances?: PluginInstances<Plugins>;
  #mounts?: Map<string, MiniflareCore<Plugins>>;
  #router?: Router;

  #wranglerConfigPath?: string;
  #watching?: boolean;
  #beforeSetupWatch?: PluginData<Plugins, Set<string>>;
  #setupWatch?: PluginData<Plugins, Set<string>>;
  #setupResults?: PluginData<Plugins, SetupResult>;
  readonly #scriptWatchPaths = new Set<string>();

  #reloaded = false;
  #globalScope?: ServiceWorkerGlobalScope;
  #bindings?: Context;
  #moduleExports?: Context;
  #watcher?: Watcher;
  #watcherCallbackMutex?: Mutex;
  #previousWatchPaths?: Set<string>;
  #previousFetchMock?: MockAgent;

  constructor(
    plugins: Plugins,
    ctx: MiniflareCoreContext,
    options: MiniflareCoreOptions<Plugins> = {} as MiniflareCoreOptions<Plugins>
  ) {
    super();
    this.#originalPlugins = plugins;
    this.#plugins = getPluginEntries(plugins);
    this.#previousSetOptions = options;
    this.#overrides = splitPluginOptions(this.#plugins, options);

    this.#ctx = ctx;
    this.#pluginStorages = new Map<keyof Plugins, PluginStorageFactory>();

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
    this.#ctx.log.verbose(`- beforeSetup(${name})`);
    const result = await instance.beforeSetup();
    this.#updateWatch(this.#beforeSetupWatch!, name, result);
    return true;
  }

  async #runSetup(name: keyof Plugins): Promise<boolean> {
    const instance = this.#instances![name];
    if (!instance.setup) return false;
    this.#ctx.log.verbose(`- setup(${name})`);
    const result = await instance.setup(this.getPluginStorage(name));
    this.#updateWatch(this.#setupWatch!, name, result);
    this.#setupResults!.set(name, result ?? {});
    return true;
  }

  readonly #initPromise: Promise<void>;
  async #init(reloadAll = false): Promise<void> {
    // The caller must eventually call #reload() at some point after #init()
    this.#ctx.log.debug("Initialising worker...");

    // Get required options
    const previous = this.#previousOptions;
    let options = this.#overrides;

    const rootPath = options.CorePlugin.rootPath ?? process.cwd();

    // Merge in wrangler config if defined
    const originalConfigPath = options.CorePlugin.wranglerConfigPath;
    const configEnv = options.CorePlugin.wranglerConfigEnv;
    let configPath =
      originalConfigPath === true ? "wrangler.toml" : originalConfigPath;
    if (configPath) {
      configPath = path.resolve(rootPath, configPath);
      this.#wranglerConfigPath = configPath;
      try {
        const configData = await fs.readFile(configPath, "utf8");
        const toml: typeof import("@iarna/toml") = require("@iarna/toml");
        const config: WranglerConfig = toml.parse(configData);
        if (configEnv && config.env && configEnv in config.env) {
          // TODO: take into account option inheritance properly
          Object.assign(config, config.env[configEnv]);
        }
        const configDir = path.dirname(configPath);

        // Add build configuration for webpack and rust builds
        _populateBuildConfig(config, configDir, configEnv);

        options = splitWranglerConfig(
          this.#plugins,
          this.#overrides,
          config,
          configDir,
          this.#ctx.log
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

    // Build compatibility manager, rebuild all plugins if reloadAll is set,
    // compatibility data, root path or any limits have changed
    const {
      compatibilityDate,
      compatibilityFlags,
      usageModel,
      globalAsyncIO,
      fetchMock,
    } = options.CorePlugin;
    let ctxUpdate =
      (this.#previousRootPath && this.#previousRootPath !== rootPath) ||
      this.#previousUsageModel !== usageModel ||
      this.#previousGlobalAsyncIO !== globalAsyncIO ||
      this.#previousFetchMock !== fetchMock ||
      reloadAll;
    this.#previousRootPath = rootPath;

    if (this.#compat) {
      if (this.#compat.update(compatibilityDate, compatibilityFlags)) {
        ctxUpdate = true;
      }
    } else {
      this.#compat = new Compatibility(compatibilityDate, compatibilityFlags);
    }

    const queueBroker = this.#ctx.queueBroker;
    const queueEventDispatcher = async (batch: MessageBatch) => {
      await this.dispatchQueue(batch);

      // TODO(soon) detect success vs failure during processing
      this.#ctx.log.info(
        `${batch.queue} (${batch.messages.length} Messages) OK`
      );
    };

    const ctx: PluginContext = {
      log: this.#ctx.log,
      compat: this.#compat,
      rootPath,
      usageModel,
      globalAsyncIO,
      fetchMock,
      queueEventDispatcher,
      queueBroker,
    };

    // Log options and compatibility flags every time they might've changed
    logOptions(this.#plugins, this.#ctx.log, options);
    const enabled = this.#compat.enabled;
    this.#ctx.log.debug(
      `Enabled Compatibility Flags:${enabled.length === 0 ? " <none>" : ""}`
    );
    for (const flag of enabled) this.#ctx.log.debug(`- ${flag}`);

    // Create plugin instances and run beforeSetup hooks, recreating any plugins
    // with changed options
    this.#instances ??= {} as PluginInstances<Plugins>;
    this.#beforeSetupWatch ??= new Map<keyof Plugins, Set<string>>();
    let ranBeforeSetup = false;
    for (const [name, plugin] of this.#plugins) {
      if (
        previous !== undefined &&
        !ctxUpdate &&
        _deepEqual(previous[name], options[name])
      ) {
        continue;
      }

      // If we have an existing instance, run its cleanup first
      const existingInstance = this.#instances[name];
      if (existingInstance?.dispose) {
        this.#ctx.log.verbose(`- dispose(${name})`);
        await existingInstance.dispose();
      }

      const instance = new plugin(ctx, options[name]);
      this.#instances[name] = instance as any;
      if (await this.#runBeforeSetup(name)) ranBeforeSetup = true;
    }

    // Run setup hooks for (re)created plugins
    this.#setupWatch ??= new Map<keyof Plugins, Set<string>>();
    this.#setupResults ??= new Map<keyof Plugins, SetupResult>();
    for (const [name] of this.#plugins) {
      if (
        previous !== undefined &&
        !ctxUpdate &&
        _deepEqual(previous[name], options[name]) &&
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

    // Update mounts
    this.#mounts ??= new Map();
    const mounts = options.CorePlugin
      .mounts as MiniflareCoreOptions<Plugins>["mounts"];
    if (mounts) {
      // Always copy watch option
      const defaultMountOptions: {
        watch?: boolean;
        kvPersist?: boolean | string;
        cachePersist?: boolean | string;
        durableObjectsPersist?: boolean | string;
      } = { watch: this.#watching || undefined };

      // Copy defined storage persistence options, we want mounted workers to
      // share the same underlying storage for shared namespaces.
      // (this tight coupling makes me sad)
      const kvPersist = resolveStoragePersist(
        rootPath,
        options.KVPlugin?.kvPersist
      );
      const cachePersist = resolveStoragePersist(
        rootPath,
        options.CachePlugin?.cachePersist
      );
      const durableObjectsPersist = resolveStoragePersist(
        rootPath,
        options.DurableObjectsPlugin?.durableObjectsPersist
      );
      if (kvPersist !== undefined) {
        defaultMountOptions.kvPersist = kvPersist;
      }
      if (cachePersist !== undefined) {
        defaultMountOptions.cachePersist = cachePersist;
      }
      if (durableObjectsPersist !== undefined) {
        defaultMountOptions.durableObjectsPersist = durableObjectsPersist;
      }

      // Create new and update existing mounts
      for (const [name, rawOptions] of Object.entries(mounts)) {
        if (name === "") {
          throw new MiniflareCoreError(
            "ERR_MOUNT_NO_NAME",
            "Mount name cannot be empty"
          );
        }

        const mountOptions: MiniflareCoreOptions<Plugins> =
          typeof rawOptions === "string"
            ? ({
                ...defaultMountOptions,
                rootPath: rawOptions,
                // Autoload configuration from files
                packagePath: true,
                envPathDefaultFallback: true,
                wranglerConfigPath: true,
              } as any)
            : {
                ...defaultMountOptions,
                ...rawOptions,
              };
        // - `"mounts" in mountOptions` detects nested mount options,
        // - `this.#ctx.isMount` detects if `setOptions()` has been called on a
        //   mount with an object containing mount options
        if ("mounts" in mountOptions || this.#ctx.isMount) {
          throw new MiniflareCoreError(
            "ERR_MOUNT_NESTED",
            "Nested mounts are unsupported"
          );
        }

        let mount = this.#mounts.get(name);
        if (mount) {
          this.#ctx.log.verbose(`Updating mount \"${name}\"...`);
          // Don't dispatch a "reload" event once the worker has reloaded,
          // this would update this (the parent's) router and reload it, which
          // we're already going to do at the end of this function.
          await mount.setOptions(mountOptions, /* dispatchReloadEvent */ false);
        } else {
          this.#ctx.log.debug(`Mounting \"${name}\"...`);
          let log = this.#ctx.log;
          // Not using `instanceof` here, we don't want subclasses
          if (Object.getPrototypeOf(this.#ctx.log) === Log.prototype) {
            log = new Log(this.#ctx.log.level, { suffix: name });
          }
          const ctx: MiniflareCoreContext = {
            ...this.#ctx,
            log,
            // Never run mounts just for module exports as there may be plugins
            // in the parent depending on the mount's exports, and the mount
            // might not have plugins depending on its own exports
            scriptRunForModuleExports: false,
            // Mark this as a mount, so we defer calling reload() hooks,
            // see #reload()
            isMount: true,
          };
          mount = new MiniflareCore(this.#originalPlugins, ctx, mountOptions);
          mount.addEventListener("reload", async (event) => {
            // Reload parent (us) whenever mounted child reloads, ignoring the
            // initial reload. This ensures the page is reloaded when live
            // reloading, and also that we're using up-to-date Durable Object
            // classes from mounts.
            if (!event.initial) {
              try {
                await this.#updateRouter();
                await this.#reload();
              } catch (e: any) {
                this.#ctx.log.error(e);
              }
            }
          });
          try {
            await mount.getPlugins();
          } catch (e: any) {
            // Make sure thrown error includes mount name for easier debugging
            throw new MiniflareCoreError(
              "ERR_MOUNT",
              `Error mounting \"${name}\"`,
              e
            );
          }
          this.#mounts.set(name, mount);
        }
      }
    }
    // Dispose old mounts (outside `if (mounts)` check in case `mounts` section
    // deleted, in which call all mounts should be unmounted)
    for (const [name, mount] of [...this.#mounts]) {
      if (mounts === undefined || !(name in mounts)) {
        this.#ctx.log.debug(`Unmounting \"${name}\"...`);
        await mount.dispose();
        this.#mounts.delete(name);
      }
    }
    await this.#updateRouter();

    // Make sure we've got a script if it's required (if we've got mounts,
    // allow no script, as we might always route to those)
    if (
      this.#ctx.scriptRequired &&
      !this.#setupResults.get("CorePlugin")?.script &&
      this.#mounts.size === 0
    ) {
      throwNoScriptError(options.CorePlugin.modules);
    }

    // #reload() is ALWAYS called eventually after this function by the caller
  }

  async #updateRouter(): Promise<void> {
    const allRoutes = new Map<string, string[]>();

    // If this (parent) worker has a name, "mount" it so more specific routes
    // are handled by it instead of mounts
    const { CorePlugin } = this.#instances!;
    if (CorePlugin.name) {
      const routes = CorePlugin.routes;
      if (routes) allRoutes.set(CorePlugin.name, routes);
    }

    // Add all other mounts
    for (const [name, mount] of this.#mounts!) {
      const { CorePlugin } = await mount.getPlugins();
      if (CorePlugin.name !== undefined && CorePlugin.name !== name) {
        throw new MiniflareCoreError(
          "ERR_MOUNT_NAME_MISMATCH",
          `Mounted name "${name}" must match service name "${CorePlugin.name}"`
        );
      }

      const routes = CorePlugin.routes;
      if (routes) allRoutes.set(name, routes);
    }

    this.#router ??= new Router();
    this.#router.update(allRoutes);
    if (this.#mounts!.size) {
      this.#ctx.log.debug(
        `Mount Routes:${this.#router.routes.length === 0 ? " <none>" : ""}`
      );
      for (let i = 0; i < this.#router.routes.length; i++) {
        const route = this.#router.routes[i];
        this.#ctx.log.debug(`${i + 1}. ${route.route} => ${route.target}`);
      }
    }
  }

  async #runAllBeforeReloads(): Promise<void> {
    for (const [name] of this.#plugins) {
      const instance = this.#instances![name];
      if (instance.beforeReload) {
        this.#ctx.log.verbose(`- beforeReload(${name})`);
        await instance.beforeReload();
      }
    }
  }

  async #runAllReloads(mounts: Map<string, _CoreMount>): Promise<void> {
    // #bindings and #moduleExports should be set, as this is always called
    // after running scripts in #reload().
    //
    // #instances should be set as #reload() always follows #init().
    const bindings = this.#bindings;
    const exports = this.#moduleExports;
    for (const [name] of this.#plugins) {
      const instance = this.#instances![name];
      if (instance.reload) {
        this.#ctx.log.verbose(`- reload(${name})`);
        await instance.reload(bindings ?? {}, exports ?? {}, mounts);
      }
    }
  }

  async #reload(dispatchReloadEvent = true): Promise<void> {
    this.#ctx.log.debug("Reloading worker...");

    const globals: Context = {};
    const bindings: Context = {};

    const newWatchPaths = new Set<string>();
    if (this.#wranglerConfigPath) newWatchPaths.add(this.#wranglerConfigPath);

    // Run all before reload hooks, including mounts if we have any
    await this.#runAllBeforeReloads();
    if (!this.#ctx.isMount) {
      // this.#mounts is set in #init() which is always called before this
      for (const mount of this.#mounts!.values()) {
        await mount.#runAllBeforeReloads();
      }
    }

    let script: ScriptBlueprint | undefined = undefined;
    let requiresModuleExports = false;
    const additionalModules: AdditionalModules = {};
    for (const [name] of this.#plugins) {
      // Build global scope, extracting script blueprints and additional modules
      const result = this.#setupResults!.get(name);
      Object.assign(globals, result?.globals);
      Object.assign(bindings, result?.bindings);
      if (result?.script) {
        if (script) {
          throw new TypeError("Multiple plugins returned a script");
        }
        script = result.script;
      }
      if (result?.requiresModuleExports) requiresModuleExports = true;
      if (result?.additionalModules) {
        Object.assign(additionalModules, result.additionalModules);
      }

      // Extract watch paths
      const beforeSetupWatch = this.#beforeSetupWatch!.get(name);
      if (beforeSetupWatch) addAll(newWatchPaths, beforeSetupWatch);
      const setupWatch = this.#setupWatch!.get(name);
      if (setupWatch) addAll(newWatchPaths, setupWatch);
    }
    const { modules, processedModuleRules, logUnhandledRejections } =
      this.#instances!.CorePlugin;

    // Clean up process-wide promise rejection event listeners
    this.#globalScope?.[kDispose]();
    // Create new global scope on each reload
    const globalScope = new ServiceWorkerGlobalScope(
      this.#ctx.log,
      globals,
      bindings,
      modules,
      logUnhandledRejections
    );
    this.#globalScope = globalScope;
    this.#bindings = bindings;
    this.#moduleExports = {};

    // Run script blueprints, with modules rules if in modules mode
    const rules = modules ? processedModuleRules : undefined;
    let res: ScriptRunnerResult | undefined = undefined;
    if (
      // Run the script if we've got one...
      script &&
      // ...and either we're always running it, or we're in modules mode
      // and require its exports
      (!this.#ctx.scriptRunForModuleExports ||
        (modules && requiresModuleExports))
    ) {
      if (!this.#ctx.scriptRunner) {
        throw new TypeError("Running scripts requires a script runner");
      }

      this.#ctx.log.verbose("Running script...");
      res = await this.#ctx.scriptRunner.run(
        globalScope,
        script,
        rules,
        additionalModules,
        this.#compat
      );

      this.#scriptWatchPaths.clear();
      this.#scriptWatchPaths.add(script.filePath);
      if (res.watch) {
        addAll(newWatchPaths, res.watch);
        addAll(this.#scriptWatchPaths, res.watch);
      }

      // Record module exports and add module event listeners if any
      this.#moduleExports = res.exports;
      if (res.exports) {
        const defaults = res.exports.default;

        const fetchListener = defaults?.fetch?.bind(defaults);
        if (fetchListener) {
          globalScope[kAddModuleFetchListener](fetchListener);
        }

        const scheduledListener = defaults?.scheduled?.bind(defaults);
        if (scheduledListener) {
          globalScope[kAddModuleScheduledListener](scheduledListener);
        }

        const queueListener = defaults?.queue?.bind(defaults);
        if (queueListener) {
          globalScope[kAddModuleQueueListener](queueListener);
        }
      }
    }

    // If this is a mount, defer calling reload() plugin hooks, these will be
    // called by the parent (us) once the root and all mounts have reloaded.
    // This ensures that if some mounts depend on other mounts, they'll
    // be ready when reload() hooks are called.
    if (!this.#ctx.isMount) {
      // Run reload hooks, getting module exports for each mount (we await
      // getPlugins() for each mount before running #reload() so their scripts
      // must've been run)
      const mounts = new Map<string, _CoreMount>();
      // this.#mounts and this.#instances are set in #init(), which is always
      // called before this
      // If this (parent) worker has a name, "mount" it so mounts can access it
      const name = this.#instances!.CorePlugin.name;
      if (name) {
        mounts.set(name, {
          moduleExports: this.#moduleExports,
          // `true` so service bindings requests always proxied to upstream,
          // `Mount`'s `dispatchFetch` requires a function with signature
          // `(Request) => Awaitable<Response>` too
          dispatchFetch: (request) => this[kDispatchFetch](request, true),
          usageModel: this.#instances!.CorePlugin.usageModel,
        } as _CoreMount);
      }
      // Add all other mounts
      for (const [name, mount] of this.#mounts!) {
        mounts.set(name, {
          moduleExports: await mount.getModuleExports(),
          dispatchFetch: (request) => mount[kDispatchFetch](request, true),
          usageModel: mount.#instances!.CorePlugin.usageModel,
        } as _CoreMount);
      }
      await this.#runAllReloads(mounts);
      for (const mount of this.#mounts!.values()) {
        await mount.#runAllReloads(mounts);
      }
    }

    // Dispatch reload event (expect if we're updating mount options via
    // setOptions() in #init(), in which call we'll call #reload() later
    // ourselves, so don't want to trigger the "reload" event listener
    // which would cause a double reload)
    if (dispatchReloadEvent) {
      const reloadEvent = new ReloadEvent("reload", {
        plugins: this.#instances!,
        initial: !this.#reloaded,
      });
      this.dispatchEvent(reloadEvent);
    }
    this.#reloaded = true;

    // Log bundle size and warning if too big
    // noinspection JSObjectNullOrUndefined
    if (res) {
      this.#ctx.log.info(
        `Worker reloaded!${
          res.bundleSize !== undefined ? ` (${formatSize(res.bundleSize)})` : ""
        }`
      );
      // TODO (someday): compress asynchronously
      // noinspection JSObjectNullOrUndefined
      if (res.bundleSize !== undefined && res.bundleSize > 1_048_576) {
        this.#ctx.log.warn(
          "Worker's uncompressed size exceeds the 1MiB limit! " +
            "Note that your worker will be compressed during upload " +
            "so you may still be able to deploy it."
        );
      }
    }

    // Update watched paths if watching
    if (this.#watching) {
      let watcher = this.#watcher;
      // Make sure we've created the watcher
      if (!watcher) {
        const {
          Watcher,
        }: typeof import("@miniflare/watcher") = require("@miniflare/watcher");
        this.#watcherCallbackMutex = new Mutex();
        watcher = new Watcher(this.#watcherCallback.bind(this));
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
        this.#ctx.log.debug(`Unwatching ${pathsToString(unwatchedPaths)}...`);
        watcher.unwatch(unwatchedPaths);
      }
      if (watchedPaths.size > 0) {
        this.#ctx.log.debug(`Watching ${pathsToString(newWatchPaths)}...`);
        watcher.watch(watchedPaths);
      }
      this.#previousWatchPaths = newWatchPaths;
    }
  }

  #ignoreScriptUpdates = false;
  #ignoreScriptUpdatesTimeout!: NodeJS.Timeout;
  #watcherCallback(eventPath: string): void {
    this.#ctx.log.debug(`${path.relative("", eventPath)} changed...`);
    if (this.#ignoreScriptUpdates && this.#scriptWatchPaths.has(eventPath)) {
      this.#ctx.log.verbose("Ignoring script change after build...");
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
    promise.catch((e) => this.#ctx.log.error(e));
  }

  get log(): Log {
    return this.#ctx.log;
  }

  async reload(): Promise<void> {
    await this.#initPromise;
    // Force re-build of all plugins, regardless of whether options have changed
    // or not. This ensures files (scripts, .env files, WASM modules, etc.) are
    // re-read from disk.
    await this.#init(/* reloadAll */ true);
    await this.#reload();
  }

  async setOptions(
    options: MiniflareCoreOptions<Plugins>,
    dispatchReloadEvent = true
  ): Promise<void> {
    await this.#initPromise;
    options = { ...this.#previousSetOptions, ...options };
    this.#previousSetOptions = options;
    this.#overrides = splitPluginOptions(this.#plugins, options);
    await this.#init();
    await this.#reload(dispatchReloadEvent);
  }

  getPluginStorage(name: keyof Plugins): StorageFactory {
    let storage = this.#pluginStorages.get(name);
    if (storage) return storage;
    this.#pluginStorages.set(
      name,
      (storage = new PluginStorageFactory(
        this.#ctx.storageFactory,
        name as string
      ))
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

  async getBindings(): Promise<Context> {
    await this.#initPromise;
    return this.#bindings!;
  }

  async getModuleExports(): Promise<Context> {
    await this.#initPromise;
    return this.#moduleExports!;
  }

  async getMount(name: string): Promise<MiniflareCore<Plugins>> {
    await this.#initPromise;
    return this.#mounts!.get(name)!;
  }

  #matchMount(url: URL): MiniflareCore<Plugins> | undefined {
    if (this.#mounts?.size) {
      const mountMatch = this.#router!.match(url);
      const name = this.#instances!.CorePlugin.name;
      // If there was a match, and it isn't the current (parent) worker,
      // forward the request to the matching mount instead
      if (mountMatch !== null && mountMatch !== name) {
        return this.#mounts.get(mountMatch);
      }
    }
  }

  async dispatchFetch<WaitUntil extends any[] = unknown[]>(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<Response<WaitUntil>> {
    await this.#initPromise;

    // noinspection SuspiciousTypeOfGuard
    let request =
      input instanceof Request && !init ? input : new Request(input, init);
    const url = new URL(request.url);

    // Forward to matching mount if any
    const mount = this.#matchMount(url);
    if (mount) return mount.dispatchFetch(request);

    // If upstream set, and the request URL doesn't begin with it, rewrite it
    // so fetching the incoming request gets a response from the upstream
    const { upstreamURL, usageModel } = this.#instances!.CorePlugin;
    if (upstreamURL && !url.toString().startsWith(upstreamURL.toString())) {
      let path = url.pathname + url.search;
      // Remove leading slash so we resolve relative to upstream's path
      if (path.startsWith("/")) path = path.substring(1);
      const newURL = new URL(path, upstreamURL);
      request = new Request(newURL, request);
      // We don't set the Host header here, fetch will automatically set it
      // based on the request url
    }

    // Each fetch gets its own context (e.g. 50 subrequests).
    // Start a new pipeline, incrementing the request depth (defaulting to 1).
    const requestDepth =
      (parseInt(request.headers.get(_kLoopHeader)!) || 0) + 1;
    // Hide the loop header from the user
    request.headers.delete(_kLoopHeader);
    return new RequestContext({
      requestDepth,
      pipelineDepth: 1,
      externalSubrequestLimit: usageModelExternalSubrequestLimit(usageModel),
    }).runWith(() =>
      this[kDispatchFetch](
        request,
        !!upstreamURL // only proxy if upstream URL set
      )
    );
  }

  // This is a separate internal function so it can be called by service
  // bindings that don't need (or want) any of the mounting stuff.
  // Declared as arrow function for correctly bound `this`.
  async [kDispatchFetch]<WaitUntil extends any[] = unknown[]>(
    request: Request,
    proxy: boolean
  ): Promise<Response<WaitUntil>> {
    await this.#initPromise;

    // Parse form data files as strings if the compatibility flag isn't set
    if (!this.#compat!.isEnabled("formdata_parser_supports_files")) {
      request = withStringFormDataFiles(request);
    }
    // Make headers immutable
    request = withImmutableHeaders(request);

    return this.#globalScope![kDispatchFetch]<WaitUntil>(request, proxy);
  }

  async dispatchScheduled<WaitUntil extends any[] = unknown[]>(
    scheduledTime?: number,
    cron?: string,
    url?: string | URL
  ): Promise<WaitUntil> {
    await this.#initPromise;

    // Forward to matching mount if any (this is primarily intended for the
    // "/cdn-cgi/mf/scheduled" route)
    if (url !== undefined) {
      if (typeof url === "string") url = new URL(url);
      const mount = this.#matchMount(url);
      if (mount) return mount.dispatchScheduled(scheduledTime, cron);
    }

    const { usageModel } = this.#instances!.CorePlugin;
    const globalScope = this.#globalScope;
    // Each fetch gets its own context (e.g. 50 subrequests).
    // Start a new pipeline too.
    return new RequestContext({
      externalSubrequestLimit: usageModelExternalSubrequestLimit(usageModel),
    }).runWith(() =>
      globalScope![kDispatchScheduled]<WaitUntil>(scheduledTime, cron)
    );
  }

  async dispatchQueue<WaitUntil extends any[] = unknown[]>(
    batch: MessageBatch
  ): Promise<WaitUntil> {
    await this.#initPromise;

    const { usageModel } = this.#instances!.CorePlugin;
    const globalScope = this.#globalScope;

    // Each fetch gets its own context (e.g. 50 subrequests).
    // Start a new pipeline too.
    return new RequestContext({
      externalSubrequestLimit: usageModelExternalSubrequestLimit(usageModel),
    }).runWith(() => {
      const result = globalScope![kDispatchQueue]<WaitUntil>(batch);
      return result;
    });
  }

  async dispose(): Promise<void> {
    // Ensure initialisation complete before disposing
    // (see https://github.com/cloudflare/miniflare/issues/341)
    await this.#initPromise;

    // Run dispose hooks
    for (const [name] of this.#plugins) {
      const instance = this.#instances?.[name];
      if (instance?.dispose) {
        this.#ctx.log.verbose(`- dispose(${name})`);
        await instance.dispose();
      }
    }
    // Dispose of watcher
    this.#watcher?.dispose();
    // Dispose of mounts
    if (this.#mounts) {
      for (const [name, mount] of this.#mounts) {
        this.#ctx.log.debug(`Unmounting \"${name}\"...`);
        await mount.dispose();
      }
      this.#mounts.clear();
    }
  }
}
