import assert from "assert";
import fs from "fs/promises";
import path from "path";
import {
  Awaitable,
  Context,
  Mount,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  RequestContext,
  SetupResult,
  getRequestContext,
} from "@miniflare/shared";
import dotenv from "dotenv";
import { MiniflareCoreError } from "../error";
import { Request, RequestInfo, RequestInit, Response } from "../standards";

const kWranglerBindings = Symbol("kWranglerBindings");

/** @internal */
export type _CoreMount = Mount<Request, Response>; // yuck :(

// Instead of binding to a service, use this function to handle `fetch`es
// some other custom way (e.g. Cloudflare Pages' `env.PAGES` asset handler)
export type FetcherFetch = (request: Request) => Awaitable<Response>;

export type ServiceBindingsOptions = Record<
  string,
  | string // Just service name, environment defaults to "production"
  | { service: string; environment?: string } // TODO (someday): respect environment, currently ignored
  | FetcherFetch
>;

interface ProcessedServiceBinding {
  name: string;
  service: string | FetcherFetch;
  environment: string;
}

export interface BindingsOptions {
  envPath?: boolean | string;
  envPathDefaultFallback?: boolean;
  bindings?: Record<string, any>;
  globals?: Record<string, any>;
  wasmBindings?: Record<string, string>;
  serviceBindings?: ServiceBindingsOptions;
}

export class Fetcher {
  readonly #service: string | FetcherFetch;
  readonly #getServiceFetch: (name: string) => Promise<FetcherFetch>;

  constructor(
    service: string | FetcherFetch,
    getServiceFetch: (name: string) => Promise<FetcherFetch>
  ) {
    this.#service = service;
    this.#getServiceFetch = getServiceFetch;
  }

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    // Check we're not too deep, should throw in the caller and NOT return a
    // 500 Internal Server Error Response from this function
    const parentCtx = getRequestContext();
    const requestDepth = parentCtx?.requestDepth ?? 1;
    const pipelineDepth = (parentCtx?.pipelineDepth ?? 0) + 1;
    // NOTE: `new RequestContext` throws if too deep
    const ctx = new RequestContext({ requestDepth, pipelineDepth });

    // Always create new Request instance, so clean object passed to services
    const req = new Request(input, init);

    // If we're using a custom fetch handler, call that or wait for the service
    // fetch handler to be available
    const fetch =
      typeof this.#service === "function"
        ? this.#service
        : await this.#getServiceFetch(this.#service);

    // Cloudflare Workers currently don't propagate errors thrown by the service
    // when handling the request. Instead a 500 Internal Server Error Response
    // is returned with the CF-Worker-Status header set to "exception". We
    // could do this, but I think for Miniflare, we get a better developer
    // experience if we don't (e.g. the pretty error page will only be shown
    // if the error reaches the HTTP request listener). We already do this for
    // Durable Objects. If user's want this behaviour, they can explicitly catch
    // the error in their service.
    // TODO: maybe add (debug/verbose) logging here?
    return ctx.runWith(() => fetch(req));
  }
}

export class BindingsPlugin
  extends Plugin<BindingsOptions>
  implements BindingsOptions
{
  @Option({
    type: OptionType.STRING,
    name: "env",
    alias: "e",
    description: "Path to .env file",
    logValue(value: boolean | string) {
      if (value === true) return ".env";
      if (value === false) return undefined;
      return path.relative("", value);
    },
    fromWrangler: ({ miniflare }) => miniflare?.env_path,
  })
  envPath?: boolean | string;

  // We want custom bindings to override Wrangler bindings, so we can't put
  // fromWrangler in `bindings`. Using a symbol, means these low-priority
  // bindings can only be loaded from a Wrangler config.
  @Option({
    type: OptionType.OBJECT,
    logName: "Wrangler Variables",
    fromWrangler: ({ vars }) => {
      if (!vars) return;
      // Wrangler stringifies all environment variables
      return Object.fromEntries(
        Object.entries(vars).map(([key, value]) => [key, String(value)])
      );
    },
  })
  [kWranglerBindings]?: Record<string, any>;

  // This is another hack. When using the CLI, we'd like to load .env files
  // by default if they exist. However, we'd also like to be able to customise
  // the .env path in wrangler.toml files. Previously, we just set `envPath` to
  // `true` if it wasn't specified via a CLI flag, but API options have a higher
  // priority than wrangler.toml's, so `[miniflare] env_path` was always
  // ignored. When this option is set to `true`, and `envPath` is undefined,
  // we'll treat is as if it were `true`.
  //
  // See https://discord.com/channels/595317990191398933/891052295410835476/923265884095647844
  @Option({ type: OptionType.NONE })
  envPathDefaultFallback?: boolean;

  @Option({
    type: OptionType.OBJECT,
    alias: "b",
    description: "Binds variable/secret to environment",
    logName: "Custom Bindings",
  })
  bindings?: Record<string, any>;

  @Option({
    type: OptionType.OBJECT,
    description: "Binds variable/secret to global scope",
    logName: "Custom Globals",
    fromWrangler: ({ miniflare }) => miniflare?.globals,
  })
  globals?: Record<string, any>;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=PATH",
    name: "wasm",
    description: "WASM module to bind",
    logName: "WASM Bindings",
    fromWrangler: ({ wasm_modules }) => wasm_modules,
  })
  wasmBindings?: Record<string, string>;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=MOUNT[@ENV]",
    name: "service",
    alias: "S",
    description: "Mounted service to bind",
    fromEntries: (entries) =>
      Object.fromEntries(
        // Allow specifying the environment on the CLI, e.g.
        // --service AUTH_SERVICE=auth@development
        entries.map(([name, serviceEnvironment]) => {
          const atIndex = serviceEnvironment.indexOf("@");
          if (atIndex === -1) {
            return [name, serviceEnvironment];
          } else {
            const service = serviceEnvironment.substring(0, atIndex);
            const environment = serviceEnvironment.substring(atIndex + 1);
            return [name, { service, environment }];
          }
        })
      ),
    fromWrangler: ({ experimental_services }) =>
      experimental_services?.reduce(
        (services, { name, service, environment }) => {
          services[name] = { service, environment };
          return services;
        },
        {} as ServiceBindingsOptions
      ),
  })
  serviceBindings?: ServiceBindingsOptions;

  readonly #processedServiceBindings: ProcessedServiceBinding[];

  #contextPromise?: Promise<void>;
  #contextResolve?: () => void;
  #mounts?: Map<string, _CoreMount>;

  constructor(ctx: PluginContext, options?: BindingsOptions) {
    super(ctx);
    this.assignOptions(options);

    if (this.envPathDefaultFallback && this.envPath === undefined) {
      this.envPath = true;
    }

    this.#processedServiceBindings = Object.entries(
      this.serviceBindings ?? {}
    ).map(([name, options]) => {
      const service = typeof options === "object" ? options.service : options;
      const environment =
        (typeof options === "object" && options.environment) || "production";
      return { name, service, environment };
    });
    if (this.#processedServiceBindings.length) {
      ctx.log.warn(
        "Service bindings are experimental and primarily meant for internal " +
          "testing at the moment. There may be breaking changes in the future."
      );
    }
  }

  #getServiceFetch = async (service: string): Promise<FetcherFetch> => {
    // Wait for mounts
    assert(
      this.#contextPromise,
      "beforeReload() must be called before #getServiceFetch()"
    );
    await this.#contextPromise;

    // Should've thrown error earlier in reload if service not found and
    // dispatchFetch should always be set, it's optional to make testing easier.
    const fetch = this.#mounts?.get(service)?.dispatchFetch;
    assert(fetch);
    return fetch;
  };

  async setup(): Promise<SetupResult> {
    // Bindings should be loaded in this order, from lowest to highest priority:
    // 1) Wrangler [vars]
    // 2) .env Variables
    // 3) WASM Module Bindings
    // 4) Service Bindings
    // 5) Custom Bindings

    const bindings: Context = {};
    const watch: string[] = [];

    // 1) Copy Wrangler bindings first
    Object.assign(bindings, this[kWranglerBindings]);

    // 2) Load bindings from .env file
    let envPath = this.envPath === true ? ".env" : this.envPath;
    if (envPath) {
      envPath = path.resolve(this.ctx.rootPath, envPath);
      try {
        Object.assign(
          bindings,
          dotenv.parse(await fs.readFile(envPath, "utf8"))
        );
      } catch (e: any) {
        // Ignore ENOENT (file not found) errors for default path
        if (!(e.code === "ENOENT" && this.envPath === true)) throw e;
      }
      watch.push(envPath);
    }

    // 3) Load WebAssembly module bindings from files
    if (this.wasmBindings) {
      // eslint-disable-next-line prefer-const
      for (let [name, wasmPath] of Object.entries(this.wasmBindings)) {
        wasmPath = path.resolve(this.ctx.rootPath, wasmPath);
        bindings[name] = new WebAssembly.Module(await fs.readFile(wasmPath));
        watch.push(wasmPath);
      }
    }

    // 4) Load service bindings
    for (const { name, service } of this.#processedServiceBindings) {
      bindings[name] = new Fetcher(service, this.#getServiceFetch);
    }

    // 5) Copy user's arbitrary bindings
    Object.assign(bindings, this.bindings);

    return { globals: this.globals, bindings, watch };
  }

  beforeReload(): void {
    // Clear reference to old mounts map, wait for reload() to be called
    // before allowing service binding `fetch`es again
    this.#mounts = undefined;
    this.#contextPromise = new Promise(
      (resolve) => (this.#contextResolve = resolve)
    );
  }

  reload(
    bindings: Context,
    moduleExports: Context,
    mounts: Map<string, Mount>
  ): void {
    // Check all services are mounted
    for (const { name, service } of this.#processedServiceBindings) {
      if (typeof service === "string" && !mounts.has(service)) {
        throw new MiniflareCoreError(
          "ERR_SERVICE_NOT_MOUNTED",
          `Service "${service}" for binding "${name}" not found.
Make sure "${service}" is mounted so Miniflare knows where to find it.`
        );
      }
    }
    this.#mounts = mounts;
    assert(
      this.#contextResolve,
      "beforeReload() must be called before reload()"
    );
    this.#contextResolve();
  }

  dispose(): void {
    return this.beforeReload();
  }
}
