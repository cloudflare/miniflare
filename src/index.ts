import assert from "assert";
import http from "http";
import path from "path";
import {
  BodyInit,
  Request,
  RequestInfo,
  RequestInit,
} from "@mrbbot/node-fetch";
import cron from "node-cron";
import sourceMap from "source-map-support";
import WebSocket from "ws";
import Youch from "youch";
import { MiniflareError } from "./error";
import { Cache, KVStorageNamespace } from "./kv";
import { ConsoleLog, Log, NoOpLog, logResponse } from "./log";
import { ResponseWaitUntil } from "./modules";
import { DurableObjectConstructor, DurableObjectNamespace } from "./modules/do";
import { ModuleFetchListener, ModuleScheduledListener } from "./modules/events";
import { Context } from "./modules/module";
import * as modules from "./modules/modules";
import { terminateWebSocket } from "./modules/ws";
import { Options, ProcessedOptions } from "./options";
import { OptionsWatcher } from "./options/watcher";
import {
  ModuleScriptInstance,
  ScriptScriptInstance,
  buildLinker,
} from "./scripts";

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
  readonly #modules: Modules;
  readonly #watcher: OptionsWatcher;
  #options?: ProcessedOptions;

  #sandbox: Context;
  #environment: Context;
  #scheduledTasks?: cron.ScheduledTask[];

  readonly #wss: WebSocket.Server;

  constructor(options: Options = {}) {
    if (options.sourceMap) {
      sourceMap.install({ emptyCacheBetweenOperations: true });
    }
    this.log = !options.log
      ? new NoOpLog()
      : options.log === true
      ? new ConsoleLog()
      : options.log;
    this.#modules = Object.entries(modules).reduce(
      (modules, [name, module]) => {
        modules[name as ModuleName] = new module(this.log) as any;
        return modules;
      },
      {} as Modules
    );

    // Defaults never used, will be overridden in #watchCallback
    this.#sandbox = {};
    this.#environment = {};

    // Initialise web socket server
    this.#wss = new WebSocket.Server({ noServer: true });
    this.#wss.addListener(
      "connection",
      this.#webSocketConnectionListener.bind(this)
    );

    this.#watcher = new OptionsWatcher(
      this.log,
      this.#watchCallback.bind(this),
      options
    );
  }

  async #watchCallback(options: ProcessedOptions): Promise<void> {
    this.#options = options;
    // Build sandbox and environment
    const modules = Object.values(this.#modules);
    this.#sandbox = modules.reduce(
      (sandbox, module) => Object.assign(sandbox, module.buildSandbox(options)),
      {} as Context
    );
    this.#environment = modules.reduce(
      (environment, module) =>
        Object.assign(environment, module.buildEnvironment(options)),
      {} as Context
    );
    // Assign bindings last so they can override modules if required
    Object.assign(this.#environment, options.bindings);

    this.#reloadScheduled();
    await this.#reloadWorker();
  }

  #reloadScheduled(): void {
    // Schedule tasks, stopping all current ones first
    this.#scheduledTasks?.forEach((task) => task.destroy());
    this.#scheduledTasks = this.#options?.validatedCrons?.map((spec) =>
      cron.schedule(spec, async () => {
        const start = process.hrtime();
        const waitUntil = this.dispatchScheduled(undefined, spec);
        await logResponse(this.log, {
          start,
          method: "SCHD",
          url: spec,
          waitUntil,
        });
      })
    );
  }

  async #reloadWorker(): Promise<void> {
    // Only called in #watchCallback() after #options set and scripts and
    // processedModulesRules are always set in this
    assert(this.#options?.scripts && this.#options.processedModulesRules);

    // Build modules linker maintaining set of referenced paths for watching
    const { linker, referencedPaths } = buildLinker(
      this.#options.processedModulesRules
    );

    // Reset state
    this.#modules.EventsModule.resetEventListeners();
    this.#modules.DurableObjectsModule.resetInstances();
    this.#modules.StandardsModule.resetWebSockets();

    // Build sandbox with global self-references, only including environment
    // in global scope if not using modules
    const sandbox = this.#options.modules
      ? { ...this.#sandbox }
      : { ...this.#sandbox, ...this.#environment };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    // Parse and run all scripts
    const moduleExports: Record<string, ModuleExports> = {};
    for (const script of Object.values(this.#options.scripts)) {
      this.log.debug(`Reloading ${path.relative("", script.fileName)}...`);

      // Parse script and build instance
      let instance: ScriptScriptInstance | ModuleScriptInstance<ModuleExports>;
      try {
        instance = this.#options.modules
          ? await script.buildModule(sandbox, linker)
          : await script.buildScript(sandbox);
      } catch (e) {
        // If this is because --experimental-vm-modules disabled, rethrow
        if (e instanceof MiniflareError) throw e;
        this.log.error(
          `Unable to parse ${path.relative(
            "",
            script.fileName
          )}: ${e} (ignoring)`
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
      if (script.fileName === this.#options.scriptPath) {
        const fetchListener = instance.exports?.default?.fetch;
        if (fetchListener) {
          this.#modules.EventsModule.addModuleFetchListener(
            fetchListener,
            this.#environment
          );
        }

        const scheduledListener = instance.exports?.default?.scheduled;
        if (scheduledListener) {
          this.#modules.EventsModule.addModuleScheduledListener(
            scheduledListener,
            this.#environment
          );
        }
      }
    }

    // Reset durable objects with new constructors and environment
    const constructors: Record<string, DurableObjectConstructor> = {};
    for (const durableObject of this.#options.processedDurableObjects ?? []) {
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
    this.#modules.DurableObjectsModule.setContext(
      constructors,
      this.#environment
    );

    // Watch module referenced paths
    assert(this.#watcher !== undefined);
    this.#watcher.setExtraWatchedPaths(referencedPaths);

    // Close all existing web sockets
    for (const ws of this.#wss.clients) {
      ws.close(1012, "Service Restart");
    }

    this.log.info("Worker reloaded!");
  }

  /** @deprecated Since 1.2.0, this is just an alias for reloadOptions() */
  async reloadScript(): Promise<void> {
    await this.reloadOptions();
  }

  async reloadOptions(log = true): Promise<void> {
    await this.#watcher.initPromise;
    await this.#watcher.reloadOptions(log);
  }

  async dispatchFetch<WaitUntil extends any[] = any[]>(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<ResponseWaitUntil<WaitUntil>> {
    await this.#watcher.initPromise;
    return this.#modules.EventsModule.dispatchFetch<WaitUntil>(
      new Request(input, init),
      this.#options?.upstreamUrl
    );
  }

  async dispatchScheduled<WaitUntil extends any[] = any[]>(
    scheduledTime?: number,
    cron?: string
  ): Promise<WaitUntil> {
    await this.#watcher.initPromise;
    return this.#modules.EventsModule.dispatchScheduled<WaitUntil>(
      scheduledTime,
      cron
    );
  }

  async getOptions(): Promise<ProcessedOptions> {
    await this.#watcher.initPromise;
    // This should never be undefined as initPromise is only resolved once
    // #watchCallback has been called for the first time
    assert(this.#options !== undefined);
    return this.#options;
  }

  async getCache(name?: string): Promise<Cache> {
    await this.#watcher.initPromise;
    return this.#modules.CacheModule.getCache(
      name,
      this.#options?.cachePersist
    );
  }

  async getKVNamespace(namespace: string): Promise<KVStorageNamespace> {
    await this.#watcher.initPromise;
    return this.#modules.KVModule.getNamespace(
      namespace,
      this.#options?.kvPersist
    );
  }

  async getDurableObjectNamespace(
    objectName: string
  ): Promise<DurableObjectNamespace> {
    await this.#watcher.initPromise;
    return this.#modules.DurableObjectsModule.getNamespace(
      objectName,
      this.#options?.durableObjectsPersist
    );
  }

  async dispose(): Promise<void> {
    await this.#watcher.dispose();
    for (const module of Object.values(this.#modules)) {
      await module.dispose();
    }
  }

  async #httpRequestListener(
    req: http.IncomingMessage,
    res?: http.ServerResponse
  ): Promise<ResponseWaitUntil | undefined> {
    const start = process.hrtime();
    const url =
      (this.#options?.upstreamUrl?.origin ?? `http://${req.headers.host}`) +
      req.url;
    const parsedUrl = new URL(url);

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

    // Add additional Cloudflare specific headers:
    // https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
    let ip = req.socket.remoteAddress;
    // Remove IPv6 prefix for IPv4 addresses
    if (ip?.startsWith("::ffff:")) ip = ip?.substring("::ffff:".length);
    req.headers["cf-connecting-ip"] = ip;
    req.headers["cf-ipcountry"] = "XX";
    req.headers["cf-ray"] = "";
    req.headers["cf-request-id"] = "";
    req.headers["cf-visitor"] = '{"scheme":"http"}';

    // Create Request with additional Cloudflare specific properties:
    // https://developers.cloudflare.com/workers/runtime-apis/request#incomingrequestcfproperties
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body,
      cf: {
        asn: 0,
        colo: "XXX",
        country: "XX",
        httpProtocol: `HTTP/${req.httpVersion}`,
        requestPriority: null,
        tlsCipher: "",
        tlsClientAuth: null,
        tlsVersion: "",
        timezone: "",
      },
    });

    // Check path matches "/.mf/scheduled" ignoring trailing slash
    const scheduled =
      parsedUrl.pathname.replace(/\/$/, "") === "/.mf/scheduled";
    let response: ResponseWaitUntil | undefined;
    let waitUntil: Promise<any[]> | undefined;

    if (scheduled) {
      req.method = "SCHD";
      const time = parsedUrl.searchParams.get("time");
      const cron = parsedUrl.searchParams.get("cron");
      waitUntil = this.dispatchScheduled(
        time ? parseInt(time) : undefined,
        cron ?? undefined
      );
      res?.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
      res?.end();
    } else {
      try {
        response = await this.dispatchFetch(request);
        waitUntil = response.waitUntil();
        // node-fetch will decompress compressed responses meaning these
        // headers are probably wrong
        response.headers.delete("content-length");
        response.headers.delete("content-encoding");
        res?.writeHead(response.status, response.headers.raw());
        res?.end(await response.buffer());
      } catch (e) {
        const youch = new Youch(e, req);
        youch.addLink(() => {
          return [
            '<a href="https://developers.cloudflare.com/workers/" target="_blank" style="text-decoration:none">📚 Workers Docs</a>',
            '<a href="https://discord.gg/cloudflaredev" target="_blank" style="text-decoration:none">💬 Workers Discord</a>',
            '<a href="https://miniflare.dev" target="_blank" style="text-decoration:none">🔥 Miniflare Docs</a>',
          ].join("");
        });
        const errorHtml = await youch.toHTML();
        res?.writeHead(500, { "Content-Type": "text/html; charset=UTF-8" });
        res?.end(errorHtml, "utf8");
        this.log.error(`${req.method} ${req.url}: ${e.stack}`);
      }
    }

    await logResponse(this.log, {
      start,
      method: req.method,
      url: req.url,
      // Don't log 500 status if this is manual scheduled event trigger
      status: scheduled ? undefined : response?.status ?? 500,
      waitUntil,
    });
    return response;
  }

  async #webSocketConnectionListener(
    ws: WebSocket,
    req: http.IncomingMessage
  ): Promise<void> {
    // Handle request in worker
    const response = await this.#httpRequestListener(req);

    // Check web socket response was returned
    const webSocket = response?.webSocket;
    if (response?.status !== 101 || !webSocket) {
      ws.close(1002, "Protocol Error");
      this.log.error(
        "Web Socket request did not return status 101 Switching Protocols response with Web Socket"
      );
      return;
    }

    // Terminate the web socket here
    await terminateWebSocket(ws, webSocket);
  }

  createServer(): http.Server {
    const server = http.createServer(this.#httpRequestListener.bind(this));

    // Handle web socket upgrades
    server.on("upgrade", (req, socket, head) => {
      this.#wss.handleUpgrade(req, socket, head, (ws) => {
        this.#wss.emit("connection", ws, req);
      });
    });

    return server;
  }
}

export * from "./kv";
export * from "./modules";
export { Log, NoOpLog, ConsoleLog } from "./log";
export { Options, MiniflareError };
