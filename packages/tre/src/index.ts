import assert from "assert";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import http from "http";
import path from "path";
import { RequestInfo, RequestInit, fetch } from "@miniflare/core";
import getPort from "get-port";
import { bold, dim, green, grey, red } from "kleur/colors";
import stoppable from "stoppable";
import { HeadersInit, Request, Response } from "undici";
import { MessageEvent, WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  CF_DAYS,
  DAY,
  DeferredPromise,
  HttpError,
  MiniflareCoreError,
  OptionalZodTypeOf,
  UnionToIntersection,
  ValueOf,
  defaultCfFetch,
  defaultCfFetchEndpoint,
  defaultCfPath,
  fallbackCf,
  filterWebSocketHeaders,
  injectCfHeaders,
} from "./helpers";

import {
  CfHeader,
  GatewayConstructor,
  GatewayFactory,
  HEADER_PROBE,
  PLUGIN_ENTRIES,
  Plugins,
  SERVICE_ENTRY,
  SOCKET_ENTRY,
} from "./plugins";
import { HEADER_CUSTOM_SERVICE } from "./plugins/core";
import {
  Config,
  Runtime,
  RuntimeConstructor,
  Service,
  Socket,
  Worker_Binding,
  getSupportedRuntime,
  serializeConfig,
} from "./runtime";
import { waitForRequest } from "./wait";
// ===== `Miniflare` User Options =====
export type WorkerOptions = UnionToIntersection<
  z.infer<ValueOf<Plugins>["options"]>
>;
export type SharedOptions = UnionToIntersection<
  z.infer<Exclude<ValueOf<Plugins>["sharedOptions"], undefined>>
>;
export type MiniflareOptions = SharedOptions &
  (WorkerOptions | { workers: WorkerOptions[] });

// ===== `Miniflare` Validated Options =====
type PluginWorkerOptions = {
  [Key in keyof Plugins]: z.infer<Plugins[Key]["options"]>;
};
type PluginSharedOptions = {
  [Key in keyof Plugins]: OptionalZodTypeOf<Plugins[Key]["sharedOptions"]>;
};

function validateOptions(
  opts: MiniflareOptions
): [PluginSharedOptions, PluginWorkerOptions[]] {
  // Normalise options into shared and worker-specific
  const sharedOpts = opts;
  const multipleWorkers = "workers" in opts;
  const workerOpts = multipleWorkers ? opts.workers : [opts];

  // Initialise return values
  const pluginSharedOpts = {} as PluginSharedOptions;
  const pluginWorkerOpts = Array.from(Array(workerOpts.length)).map(
    () => ({} as PluginWorkerOptions)
  );

  // Validate all options
  for (const [key, plugin] of PLUGIN_ENTRIES) {
    // @ts-expect-error pluginSharedOpts[key] could be any plugin's
    pluginSharedOpts[key] = plugin.sharedOptions?.parse(sharedOpts);
    for (let i = 0; i < workerOpts.length; i++) {
      // Make sure paths are correct in validation errors
      const path = multipleWorkers ? ["workers", i] : undefined;
      // @ts-expect-error pluginWorkerOpts[i][key] could be any plugin's
      pluginWorkerOpts[i][key] = plugin.options.parse(workerOpts[i], { path });
    }
  }

  return [pluginSharedOpts, pluginWorkerOpts];
}

// ===== `Miniflare` Internal Storage & Routing =====
type OptionalGatewayFactoryType<
  Gateway extends GatewayConstructor<any> | undefined
> = Gateway extends GatewayConstructor<any>
  ? GatewayFactory<InstanceType<Gateway>>
  : undefined;
type OptionalInstanceType<
  T extends (abstract new (...args: any) => any) | undefined
> = T extends abstract new (...args: any) => any ? InstanceType<T> : undefined;
type PluginGatewayFactories = {
  [Key in keyof Plugins]: OptionalGatewayFactoryType<Plugins[Key]["gateway"]>;
};
type PluginRouters = {
  [Key in keyof Plugins]: OptionalInstanceType<Plugins[Key]["router"]>;
};

const RUNTIME_PATH = path.resolve(__dirname, "..", "..", "lib", "cfwrkr");

type StoppableServer = http.Server & stoppable.WithStop;

export class Miniflare {
  readonly #gatewayFactories: PluginGatewayFactories;
  readonly #routers: PluginRouters;
  #cf = fallbackCf;
  #optionsVersion: number;
  #sharedOpts: PluginSharedOptions;
  #workerOpts: PluginWorkerOptions[];
  #initialConfigPromise?: Promise<Config>;

  readonly #runtimeConstructor: RuntimeConstructor;
  #runtime?: Runtime;
  #runtimeEntryURL?: URL;

  readonly #disposeController: AbortController;
  readonly #initPromise: Promise<void>;
  #loopbackServer?: StoppableServer;

  #updatePromise?: Promise<void>;

  #proxyServer?: StoppableServer;

  constructor(opts: MiniflareOptions) {
    // Initialise plugin gateway factories and routers
    this.#gatewayFactories = {} as PluginGatewayFactories;
    this.#routers = {} as PluginRouters;
    this.#initPlugins();

    // Split and validate options
    const [sharedOpts, workerOpts] = validateOptions(opts);
    this.#optionsVersion = 1;
    this.#sharedOpts = sharedOpts;
    this.#workerOpts = workerOpts;
    // Assemble config asynchronously whilst initialising finishes
    this.#initialConfigPromise = this.#assembleConfig();

    // Get supported shell for executing runtime binary
    // TODO: allow this to be configured if necessary
    this.#runtimeConstructor = getSupportedRuntime();
    // TODO: use logger
    const desc = this.#runtimeConstructor.description;
    console.log(
      grey(`Running the 🦄 Cloudflare Workers Runtime 🦄 ${desc}...`)
    );

    this.#disposeController = new AbortController();
    this.#initPromise = this.#init();
  }

  #initPlugins() {
    for (const [key, plugin] of PLUGIN_ENTRIES) {
      if (plugin.gateway !== undefined && plugin.router !== undefined) {
        const gatewayFactory = new GatewayFactory<any>(key, plugin.gateway);
        const router = new plugin.router(gatewayFactory);
        // @ts-expect-error this.#gatewayFactories[key] could be any plugin's
        this.#gatewayFactories[key] = gatewayFactory;
        // @ts-expect-error this.#routers[key] could be any plugin's
        this.#routers[key] = router;
      }
    }
  }
  async #setupCf(): Promise<void> {
    // Default to enabling cfFetch if we're not testing
    let cfPath = this.#sharedOpts.core.cfFetch ?? defaultCfFetch;
    // If cfFetch is disabled or we're using a custom provider, don't fetch the
    // cf object
    if (!cfPath) return;
    if (cfPath === true) cfPath = defaultCfPath;
    // Determine whether to refetch cf.json, should do this if doesn't exist
    // or expired

    // Determine whether to refetch cf.json, should do this if doesn't exist
    // or expired
    let refetch = true;
    try {
      // Try load cfPath, if this fails, we'll catch the error and refetch.
      // If this succeeds, and the file is stale, that's fine: it's very likely
      // we'll be fetching the same data anyways.
      this.#cf = JSON.parse(await readFile(cfPath, "utf8"));
      const cfStat = await stat(cfPath);
      refetch = Date.now() - cfStat.mtimeMs > CF_DAYS * DAY;
    } catch {}

    // If no need to refetch, stop here, otherwise fetch
    if (!refetch) return;
    try {
      const res = await fetch(defaultCfFetchEndpoint);
      const cfText = await res.text();
      this.#cf = JSON.parse(cfText);
      // Write cf so we can reuse it later
      await mkdir(path.dirname(cfPath), { recursive: true });
      await writeFile(cfPath, cfText, "utf8");
      console.log(grey("Updated `Request.cf` object cache!"));
    } catch (e: any) {
      console.log(
        bold(
          red(`Unable to fetch the \`Request.cf\` object! Falling back to a default placeholder...
${dim(e.cause ? e.cause.stack : e.stack)}`)
        )
      );
    }
  }
  // Initialise a proxy server that adds the `CF-Blob` header to runtime requests
  #createServer(port: number): http.Server {
    const proxyWebSocketServer = new WebSocketServer({ noServer: true });
    proxyWebSocketServer.on("connection", (client, request) => {
      // Filter out browser WebSocket headers, since `ws` injects some. Leaving browser ones in causes key mismatches, especially with `Sec-WebSocket-Accept`
      const safeHeaders = filterWebSocketHeaders(request.headers);

      const runtime = new WebSocket(`ws://127.0.0.1:${port}${request.url}`, {
        headers: injectCfHeaders(safeHeaders, this.#cf),
      });

      // Proxy messages to and from the runtime
      client.addEventListener("message", (e: MessageEvent) =>
        runtime.send(e.data)
      );
      client.addEventListener("close", () => runtime.close());

      runtime.addEventListener("message", (e: MessageEvent) => {
        client.send(e.data);
      });
      runtime.addEventListener("close", () => client.close());
    });
    const server = http.createServer((originalRequest, originalResponse) => {
      const proxyToRuntime = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: originalRequest.url,
          method: originalRequest.method,
          headers: injectCfHeaders(originalRequest.headers, this.#cf),
        },
        (runtime) => {
          originalResponse.writeHead(
            runtime.statusCode as number,
            runtime.headers
          );
          runtime.pipe(originalResponse);
        }
      );

      originalRequest.pipe(proxyToRuntime);
    });
    // Handle websocket requests
    server.on("upgrade", (request, socket, head) => {
      proxyWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
        proxyWebSocketServer.emit("connection", ws, request);
      });
    });

    return server;
  }

  async startServer() {
    await this.#initPromise;
    const port = await getPort({ port: this.#sharedOpts.core.port });
    const host = this.#sharedOpts.core.host ?? "127.0.0.1";
    this.#proxyServer = stoppable(
      this.#createServer(Number(this.#runtimeEntryURL?.port))
    );

    await new Promise<void>((resolve) => {
      (this.#proxyServer as StoppableServer).listen(port, host, () =>
        resolve()
      );
    });
    console.log(bold(green(`Ready on http://${host}:${port}! 🎉`)));
  }
  async dispatchFetch(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<Response> {
    let forward: Request;
    let url: URL;
    // Depending on the form of the input, construct a new request with the `host` set to the internal runtime URL
    if (input instanceof URL || typeof input == "string") {
      url = input instanceof URL ? input : new URL(input as string);
      url.host = (this.#runtimeEntryURL as URL).host;
      forward = new Request(url, {
        ...init,
        headers: injectCfHeaders(init?.headers ?? {}, this.#cf),
      });
    } else {
      url = new URL(input.url);
      url.host = (this.#runtimeEntryURL as URL).host;
      forward = new Request(url, {
        ...(input as RequestInit),
        headers: injectCfHeaders(input?.headers ?? {}, this.#cf),
      });
    }
    return await fetch(url, forward as RequestInit);
  }
  async #init() {
    await this.#setupCf();
    // Start loopback server (how the runtime accesses with Miniflare's storage)
    this.#loopbackServer = await this.#startLoopbackServer(0, "127.0.0.1");
    const address = this.#loopbackServer.address();
    // Note address would be string with unix socket
    assert(address !== null && typeof address === "object");
    // noinspection JSObjectNullOrUndefined
    const loopbackPort = address.port;

    // Start runtime
    const entryPort = await getPort();
    // TODO: respect entry `host` option
    // TODO: download/cache from GitHub releases or something, or include in pkg?
    this.#runtime = new this.#runtimeConstructor(
      RUNTIME_PATH,
      entryPort,
      loopbackPort
    );
    this.#runtimeEntryURL = new URL(`http://127.0.0.1:${entryPort}`);

    const config = await this.#initialConfigPromise;
    assert(config !== undefined);
    this.#initialConfigPromise = undefined;
    const configBuffer = serializeConfig(config);
    await this.#runtime.updateConfig(configBuffer);

    // Wait for runtime to start
    await this.#waitForRuntime();
  }

  async #handleLoopbackCustomService(
    request: Request,
    customService: string
  ): Promise<Response> {
    const slashIndex = customService.indexOf("/");
    // TODO: technically may want to keep old versions around so can always
    //  recover this in case of setOptions()?
    const workerIndex = parseInt(customService.substring(0, slashIndex));
    const serviceName = customService.substring(slashIndex + 1);
    const service =
      this.#workerOpts[workerIndex]?.core.serviceBindings?.[serviceName];
    // Should only define custom service bindings if `service` is a function
    assert(typeof service === "function");
    try {
      const response = await service(request);
      // Validate return type as `service` is a user defined function
      // TODO: should we validate outside this try/catch?
      return z.instanceof(Response).parse(response);
    } catch (e: any) {
      // TODO: do we need to add `CF-Exception` header or something here?
      //  check what runtime does
      return new Response(e?.stack ?? e, { status: 500 });
    }
  }

  async #handleLoopbackPlugins(
    request: Request,
    url: URL
  ): Promise<Response | undefined> {
    const pathname = url.pathname;
    for (const [key] of PLUGIN_ENTRIES) {
      const pluginPrefix = `/${key}`;
      if (pathname.startsWith(pluginPrefix)) {
        // Reuse existing URL object, just remove prefix from pathname
        url.pathname = pathname.substring(pluginPrefix.length);
        // Try route using this plugin, and respond if matched
        try {
          const response = await this.#routers[key]?.route(request, url);
          if (response !== undefined) return response;
        } catch (e) {
          if (e instanceof HttpError) {
            return new Response(e.message, {
              status: e.code,
              // Custom statusMessage is required for runtime error messages
              statusText: e.message.substring(0, 512),
            });
          }
          throw e;
        }
      }
    }
  }

  #handleLoopback: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "", "http://127.0.0.1");
    // TODO: maybe just use native Node http objects?
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    });

    let response: Response | undefined;
    const customService = request.headers.get(HEADER_CUSTOM_SERVICE);
    if (customService !== null) {
      response = await this.#handleLoopbackCustomService(
        request,
        customService
      );
    } else {
      // TODO: check for proxying/outbound fetch header first (with plans for fetch mocking)
      response = await this.#handleLoopbackPlugins(request, url);
    }

    if (response === undefined) {
      res.writeHead(404);
      return res.end();
    }

    res.writeHead(
      response.status,
      response.statusText,
      Object.fromEntries(response.headers)
    );
    if (response.body) {
      for await (const chunk of response.body) {
        if (chunk) res.write(chunk);
      }
    }
    res.end();
  };

  #startLoopbackServer(
    port: string | number,
    hostname?: string
  ): Promise<StoppableServer> {
    return new Promise((resolve) => {
      const server = stoppable(http.createServer(this.#handleLoopback));
      server.listen(port as any, hostname, () => resolve(server));
    });
  }

  #stopLoopbackServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      assert(this.#loopbackServer !== undefined);
      this.#loopbackServer.stop((err) => (err ? reject(err) : resolve()));
    });
  }
  #stopProxyServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#proxyServer !== undefined)
        this.#proxyServer.stop((err) => (err ? reject(err) : resolve()));
    });
  }

  async #waitForRuntime() {
    await waitForRequest(this.#runtimeEntryURL!, {
      headers: { [HEADER_PROBE]: this.#optionsVersion.toString() },
      signal: this.#disposeController.signal,
    });
  }

  async #assembleConfig(): Promise<Config> {
    // Copy options in case `setOptions` called whilst assembling config
    const optionsVersion = this.#optionsVersion;
    const allWorkerOpts = this.#workerOpts;
    const sharedOpts = this.#sharedOpts;

    const services: Service[] = [];
    const sockets: Socket[] = [
      {
        name: SOCKET_ENTRY,
        http: { cfBlobHeader: CfHeader.Blob },
        service: { name: SERVICE_ENTRY },
      },
    ];

    // Dedupe services by name
    const serviceNames = new Set<string>();

    for (let i = 0; i < allWorkerOpts.length; i++) {
      const workerOpts = allWorkerOpts[i];
      // Collect all bindings from this worker
      const workerBindings: Worker_Binding[] = [];
      for (const [key, plugin] of PLUGIN_ENTRIES) {
        const pluginBindings = await plugin.getBindings(workerOpts[key]);
        if (pluginBindings !== undefined) {
          workerBindings.push(...pluginBindings);
        }
      }

      // Collect all services required by this worker
      for (const [key, plugin] of PLUGIN_ENTRIES) {
        const pluginServices = await plugin.getServices({
          options: workerOpts[key],
          optionsVersion,
          sharedOptions: sharedOpts[key],
          workerBindings,
          workerIndex: i,
        });
        if (pluginServices !== undefined) {
          for (const service of pluginServices) {
            if (service.name !== undefined && !serviceNames.has(service.name)) {
              serviceNames.add(service.name);
              services.push(service);
            }
          }
        }
      }
    }

    return { services, sockets };
  }

  get ready() {
    return this.#initPromise;
  }

  #checkDisposed() {
    if (this.#disposeController.signal.aborted) {
      throw new MiniflareCoreError(
        "ERR_DISPOSED",
        "Cannot use disposed instance"
      );
    }
  }

  async setOptions(opts: MiniflareOptions) {
    this.#checkDisposed();

    const updatePromise = new DeferredPromise<void>();
    this.#updatePromise = updatePromise;

    // Wait for initial initialisation before changing options
    await this.#initPromise;

    // Split and validate options
    // TODO: merge with previous config
    const [sharedOpts, workerOpts] = validateOptions(opts);
    // Increment version, so we know when runtime has processed updates
    this.#optionsVersion++;
    this.#sharedOpts = sharedOpts;
    this.#workerOpts = workerOpts;

    // Assemble and serialize config
    const currentOptionsVersion = this.#optionsVersion;
    const config = await this.#assembleConfig();
    // If `setOptions` called again, discard our now outdated config
    if (currentOptionsVersion !== this.#optionsVersion) return;
    const configBuffer = serializeConfig(config);

    // Send to runtime and wait for updates to process
    assert(this.#runtime !== undefined);
    await this.#runtime.updateConfig(configBuffer);
    await this.#waitForRuntime();
    updatePromise.resolve();
  }

  async dispose() {
    this.#disposeController.abort();
    await this.#initPromise;
    await this.#updatePromise;
    this.#runtime?.dispose();
    await this.#stopLoopbackServer();
    await this.#stopProxyServer();
  }
}

export * from "./helpers";
export * from "./plugins";
export * from "./runtime";
export * from "./storage";
