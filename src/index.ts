import http from "http";
import vm from "vm";
import { BodyInit, Request } from "@mrbbot/node-fetch";
import cron from "node-cron";
import sourceMap from "source-map-support";
import { KVStorageNamespace } from "./kv";
import { ConsoleLog, Log, NoOpLog, logResponse } from "./log";
import { Cache, ResponseWaitUntil } from "./modules";
import { Sandbox } from "./modules/module";
import * as modules from "./modules/modules";
import { Options, ProcessedOptions } from "./options";
import { Watcher } from "./watcher";

type ModuleName = keyof typeof modules;
type Modules = {
  [K in ModuleName]: InstanceType<typeof modules[K]>;
};

class SandboxedScript {
  private readonly _script: vm.Script;
  private readonly _context: vm.Context;

  constructor(script: vm.Script, sandbox: Sandbox) {
    this._script = script;
    this._context = vm.createContext(sandbox, {
      codeGeneration: { strings: false },
    });
  }

  run() {
    this._script.runInContext(this._context);
  }
}

export class Miniflare {
  readonly log: Log;
  private readonly _modules: Modules;
  private readonly _initPromise: Promise<void>;
  private _initResolve?: () => void;
  private _watcher?: Watcher;
  private _options?: ProcessedOptions;
  private _previousOptionsKey?: number;
  private _sandbox?: Sandbox;
  private _worker?: SandboxedScript;
  private _scheduledTasks?: cron.ScheduledTask[];

  constructor(script: vm.Script, options?: Options);
  constructor(scriptPath: string, options?: Options);
  constructor(script: vm.Script | string, options: Options = {}) {
    if (options.sourceMap) sourceMap.install();
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

    this._previousOptionsKey = -1;
    this._initPromise = new Promise(async (resolve) => {
      this._initResolve = resolve;
      this._watcher = new Watcher(
        this.log,
        this._watchCallback.bind(this),
        script,
        options
      );
    });
  }

  private _watchCallback(
    script: vm.Script,
    options: ProcessedOptions,
    optionsKey: number
  ) {
    if (
      this._sandbox === undefined ||
      this._previousOptionsKey !== optionsKey
    ) {
      this._previousOptionsKey = optionsKey;
      this._options = options;
      this._sandbox = this._buildSandbox(options);
      this._reloadScheduled();
    }
    this._reloadWorker(script, this._sandbox);
    // This should never be undefined as _watchCallback is only called by the
    // watcher which is created after _initResolve is set
    // TODO: wrap this call with an if statement and type error as with watcher
    //  to assert this
    this._initResolve?.();
  }

  private _buildSandbox(options: ProcessedOptions): Sandbox {
    const sandbox = Object.values(this._modules).reduce(
      (sandbox, module) => Object.assign(sandbox, module.buildSandbox(options)),
      {} as Sandbox
    );
    // Assign bindings last so they can override modules if required
    Object.assign(sandbox, options.bindings);
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    return sandbox;
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

  private _reloadWorker(script: vm.Script, sandbox: Sandbox) {
    delete this._worker;
    this._modules.EventsModule.removeEventListeners();
    this._worker = new SandboxedScript(script, sandbox);
    try {
      this._worker.run();
    } catch (e) {
      this.log.error(e.stack);
    }
    this.log.info("Worker reloaded!");
  }

  async reloadScript(): Promise<void> {
    await this._initPromise;
    await this._watcher?.reloadScript();
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
    // _watchCallback has been called for the first time, where
    // _previousOptionsKey will be -1, which is not equal to 0, the first
    // options key from the Watcher, meaning _options will be set to options.
    // TODO: wrap this call with an if statement and type error as with watcher
    //  to assert this
    return this._options as ProcessedOptions;
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
