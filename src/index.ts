import assert from "assert";
import http from "http";
import path from "path";
import { BodyInit, Request } from "@mrbbot/node-fetch";
import cron from "node-cron";
import sourceMap from "source-map-support";
import { Cache, KVStorageNamespace } from "./kv";
import { ConsoleLog, Log, NoOpLog, logResponse } from "./log";
import { ResponseWaitUntil } from "./modules";
import { DurableObjectConstructor } from "./modules/do";
import { ModuleFetchListener, ModuleScheduledListener } from "./modules/events";
import { Context } from "./modules/module";
import * as modules from "./modules/modules";
import { Options, ProcessedOptions, stringScriptPath } from "./options";
import { ModuleScriptInstance, ScriptScriptInstance } from "./scripts";
import { Watcher } from "./watcher";

type ModuleName = keyof typeof modules;
type Modules = {
  [K in ModuleName]: InstanceType<typeof modules[K]>;
};

type ModuleExports = {
  [key in Exclude<string, "default">]?: DurableObjectConstructor;
} & {
  default?: {
    fetch?: ModuleFetchListener;
    scheduled?: ModuleScheduledListener;
  };
};

export class Miniflare {
  readonly log: Log;
  private readonly _modules: Modules;
  private readonly _initPromise: Promise<void>;
  private _initResolve?: () => void;
  private _watcher?: Watcher;
  private _options?: ProcessedOptions;

  private _sandbox: Context;
  private _environment: Context;
  private _scheduledTasks?: cron.ScheduledTask[];

  constructor(options: Options) {
    if (options.script) options.scriptPath = stringScriptPath;
    if (options.sourceMap) {
      sourceMap.install({ emptyCacheBetweenOperations: true });
    }
    this.log = !options.log
      ? new NoOpLog()
      : options.log === true
      ? new ConsoleLog()
      : options.log;
    this._modules = Object.entries(modules).reduce(
      (modules, [name, module]) => {
        modules[name as ModuleName] = new module(this.log) as any;
        return modules;
      },
      {} as Modules
    );

    // Defaults never used, will be overridden in _watchCallback
    this._sandbox = {};
    this._environment = {};

    this._initPromise = new Promise(async (resolve) => {
      this._initResolve = resolve;

      this._watcher = new Watcher(
        this.log,
        this._watchCallback.bind(this),
        options
      );
    });
  }

  private async _watchCallback(options: ProcessedOptions) {
    this._options = options;
    // Build sandbox and environment
    const modules = Object.values(this._modules);
    this._sandbox = modules.reduce(
      (sandbox, module) => Object.assign(sandbox, module.buildSandbox(options)),
      {} as Context
    );
    this._environment = modules.reduce(
      (environment, module) =>
        Object.assign(environment, module.buildEnvironment(options)),
      {} as Context
    );
    // Assign bindings last so they can override modules if required
    Object.assign(this._environment, options.bindings);

    this._reloadScheduled();
    await this._reloadWorker();

    // This should never be undefined as _watchCallback is only called by the
    // watcher which is created after _initResolve is set
    assert(this._initResolve !== undefined);
    this._initResolve();
  }

  private _reloadScheduled(): void {
    // Schedule tasks, stopping all current ones first
    this._scheduledTasks?.forEach((task) => task.destroy());
    this._scheduledTasks = this._options?.validatedCrons?.map((spec) =>
      cron.schedule(spec, async () => {
        const start = process.hrtime();
        const waitUntil = this.dispatchScheduled();
        await logResponse(this.log, {
          start,
          method: "SCHD",
          url: spec,
          waitUntil,
        });
      })
    );
  }

  private async _reloadWorker() {
    // Should never return, only called in _watchCallback() after _options set
    // and scripts and modulesLinker are always set
    if (!(this._options?.scripts && this._options?.modulesLinker)) return;

    // Reset state
    this._modules.EventsModule.resetEventListeners();
    this._modules.DurableObjectsModule.resetInstances();

    // Build sandbox with global self-references, only including environment
    // in global scope if not using modules
    const sandbox = this._options.modules
      ? { ...this._sandbox }
      : { ...this._sandbox, ...this._environment };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    // Parse and run all scripts
    const moduleExports: Record<string, ModuleExports> = {};
    for (const script of Object.values(this._options.scripts)) {
      this.log.debug(`Reloading ${path.relative("", script.fileName)}...`);

      // Parse script and build instance
      let instance: ScriptScriptInstance | ModuleScriptInstance<ModuleExports>;
      try {
        instance = this._options.modules
          ? await script.buildModule(sandbox, this._options.modulesLinker)
          : await script.buildScript(sandbox);
      } catch (e) {
        this.log.error(
          `Unable to parse ${path.relative("", script.fileName)}: ${e}`
        );
        continue;
      }

      // Run script
      try {
        await instance.run();
      } catch (e) {
        this.log.error(e.stack);
        continue;
      }

      // If this isn't a module instance, move on to the next script
      if (!(instance instanceof ModuleScriptInstance)) continue;

      // Store the namespace so we can extract its Durable Object constructors
      moduleExports[script.fileName] = instance.exports;

      // If this is the main modules script, setup event listeners for
      // default exports
      if (script.fileName === this._options.scriptPath) {
        const fetchListener = instance.exports?.default?.fetch;
        if (fetchListener) {
          this._modules.EventsModule.addModuleFetchListener(
            fetchListener,
            this._environment
          );
        }

        const scheduledListener = instance.exports?.default?.scheduled;
        if (scheduledListener) {
          this._modules.EventsModule.addModuleScheduledListener(
            scheduledListener,
            this._environment
          );
        }
      }
    }

    // Reset durable objects with new constructors and environment
    const constructors: Record<string, DurableObjectConstructor> = {};
    for (const durableObject of this._options.processedDurableObjects ?? []) {
      const constructor =
        moduleExports[durableObject.scriptPath]?.[durableObject.className];
      if (constructor) {
        constructors[durableObject.name] = constructor;
      } else {
        this.log.error(
          `Unable to find class ${durableObject.className} for Durable Object ${durableObject.name}`
        );
      }
    }
    this._modules.DurableObjectsModule.setContext(
      constructors,
      this._environment
    );

    this.log.info("Worker reloaded!");
  }

  async reloadScript(): Promise<void> {
    await this._initPromise;
    await this._watcher?.reloadScripts();
  }

  async reloadOptions(): Promise<void> {
    await this._initPromise;
    await this._watcher?.reloadOptions();
  }

  async dispatchFetch<WaitUntil extends any[] = any[]>(
    request: Request
  ): Promise<ResponseWaitUntil<WaitUntil>> {
    await this._initPromise;
    return this._modules.EventsModule.dispatchFetch<WaitUntil>(
      request,
      this._options?.upstreamUrl
    );
  }

  async dispatchScheduled<WaitUntil extends any[] = any[]>(
    scheduledTime?: number
  ): Promise<WaitUntil> {
    await this._initPromise;
    return this._modules.EventsModule.dispatchScheduled<WaitUntil>(
      scheduledTime
    );
  }

  async getOptions(): Promise<ProcessedOptions> {
    await this._initPromise;
    // This should never be undefined as _initPromise is only resolved once
    // _watchCallback has been called for the first time
    assert(this._options !== undefined);
    return this._options;
  }

  async getCache(name?: string): Promise<Cache> {
    await this._initPromise;
    return this._modules.CacheModule.getCache(
      name,
      this._options?.cachePersist
    );
  }

  // TODO: maybe rename to getKVNamespace()
  async getNamespace(namespace: string): Promise<KVStorageNamespace> {
    await this._initPromise;
    return this._modules.KVModule.getNamespace(
      namespace,
      this._options?.kvPersist
    );
  }

  private async _httpRequestListener(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const start = process.hrtime();
    const url =
      (this._options?.upstreamUrl?.origin ?? `http://${req.headers.host}`) +
      req.url;

    let body: BodyInit | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      // If the Transfer-Encoding is not chunked, buffer the request. If we
      // didn't do this and tried to make a fetch with this body in the worker,
      // it would be sent with chunked Transfer-Encoding, since req is a stream.
      if (req.headers["transfer-encoding"]?.includes("chunked")) {
        body = req;
      } else if (req.headers["content-length"] !== "0") {
        body = await new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req,
        }).buffer();
      }
    }

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body,
    });

    // TODO: add cf headers

    let response: ResponseWaitUntil | undefined;
    try {
      response = await this.dispatchFetch(request);
      response.headers.delete("content-length");
      response.headers.delete("content-encoding");
      res.writeHead(response.status, response.headers.raw());
      res.end(await response.buffer());
    } catch (e) {
      res.writeHead(500);
      res.end(e.stack);
      this.log.error(e.stack);
    }
    await logResponse(this.log, {
      start,
      method: req.method,
      url: req.url,
      status: response?.status ?? 500,
      waitUntil: response?.waitUntil(),
    });
  }

  createServer(): http.Server {
    return http.createServer(this._httpRequestListener.bind(this));
  }
}

export * from "./kv";
export * from "./modules";
export { Log, NoOpLog, ConsoleLog } from "./log";
export { Options };
