import { Blob } from "buffer";
import fs from "fs/promises";
import path from "path";
import {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TextDecoderStream,
  TextEncoderStream,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} from "stream/web";
// Import all of `stream/web` so we don't get a syntax error when trying to
// import `(De)CompressionStream` on Node < 17.0.0. We can't import dynamically
// either as `CorePlugin` construction is synchronous.
import webStreams from "stream/web";
import { URL, URLSearchParams } from "url";
import { TextDecoder, TextEncoder } from "util";
import {
  AdditionalModules,
  CompatibilityFlag,
  Context,
  ModuleRule,
  ModuleRuleType,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  ProcessedModuleRule,
  RouteType,
  STRING_SCRIPT_PATH,
  SetupResult,
  globsToMatcher,
  structuredCloneImpl,
} from "@miniflare/shared";
import { File, FormData, Headers, MockAgent } from "undici";
// @ts-expect-error `urlpattern-polyfill` only provides global types
import { URLPattern } from "urlpattern-polyfill";
import { MiniflareCoreError } from "../error";
import {
  AbortSignal,
  CompressionStream,
  CryptoKey,
  DOMException,
  DecompressionStream,
  FetchEvent,
  FixedLengthStream,
  IdentityTransformStream,
  Navigator,
  Request,
  Response,
  ScheduledEvent,
  Scheduler,
  WorkerGlobalScope,
  atob,
  btoa,
  createCompatFetch,
  createCrypto,
  createDate,
  createTimer,
  fetch,
  withStringFormDataFiles,
} from "../standards";
import { assertsInRequest } from "../standards/helpers";
import type { BindingsOptions } from "./bindings";
import { additionalNodeModules } from "./node";

const DEFAULT_MODULE_RULES: ModuleRule[] = [
  { type: "ESModule", include: ["**/*.mjs"] },
  { type: "CommonJS", include: ["**/*.js", "**/*.cjs"] },
];

function proxyStringFormDataFiles<
  Class extends typeof Request | typeof Response
>(klass: Class) {
  return new Proxy(klass, {
    construct(target, args, newTarget) {
      const value = Reflect.construct(target, args, newTarget);
      return withStringFormDataFiles(value);
    },
  });
}

function proxyDisableStreamConstructor<
  Class extends
    | typeof ReadableStream
    | typeof WritableStream
    | typeof TransformStream
>(klass: Class) {
  return new Proxy(klass, {
    construct() {
      throw new Error(
        `To use the new ${klass.name}() constructor, enable the streams_enable_constructors feature flag.`
      );
    },
  });
}

export interface CoreOptions {
  script?: string;
  scriptPath?: string;
  rootPath?: string;
  packagePath?: boolean | string;
  wranglerConfigPath?: boolean | string;
  wranglerConfigEnv?: string;
  modules?: boolean;
  modulesRules?: ModuleRule[];
  compatibilityDate?: string;
  compatibilityFlags?: CompatibilityFlag[];
  usageModel?: "bundled" | "unbound";
  upstream?: string;
  watch?: boolean;
  // CLI only options, not actually used by MiniflareCore
  debug?: boolean;
  verbose?: boolean;
  updateCheck?: boolean;
  repl?: boolean;
  // Replaced in MiniflareCoreOptions with something plugins-specific
  mounts?: Record<string, string | CoreOptions | BindingsOptions>;
  name?: string;
  routes?: string[];
  logUnhandledRejections?: boolean;
  fetchMock?: MockAgent;
  globalAsyncIO?: boolean;
  globalTimers?: boolean;
  globalRandom?: boolean;
  actualTime?: boolean;
  inaccurateCpu?: boolean;
}

function mapMountEntries(
  [name, pathEnv]: [string, string],
  relativeTo?: string
): [string, CoreOptions | BindingsOptions] {
  let wranglerConfigEnv;
  const atIndex = pathEnv.lastIndexOf("@");
  if (atIndex !== -1) {
    wranglerConfigEnv = pathEnv.substring(atIndex + 1);
    pathEnv = pathEnv.substring(0, atIndex);
  }
  if (relativeTo) pathEnv = path.resolve(relativeTo, pathEnv);
  return [
    name,
    {
      rootPath: pathEnv,
      wranglerConfigEnv,
      // Autoload configuration from files
      packagePath: true,
      envPathDefaultFallback: true,
      wranglerConfigPath: true,
    },
  ];
}

export class CorePlugin extends Plugin<CoreOptions> implements CoreOptions {
  // Both script and scriptPath are optional, this allows us not to pass a
  // script for testing (e.g. Jest environment). The CLI should error if no
  // script is passed though.
  @Option({ type: OptionType.NONE, logValue: () => STRING_SCRIPT_PATH })
  script?: string;
  @Option({
    type: OptionType.STRING_POSITIONAL,
    name: "script",
    fromWrangler: ({ build }, configDir) =>
      build?.upload?.main
        ? path.resolve(
            configDir,
            build?.upload?.dir ?? "dist",
            build.upload.main
          )
        : undefined,
  })
  scriptPath?: string;

  @Option({
    type: OptionType.STRING,
    name: "wrangler-config",
    alias: "c",
    description: "Path to wrangler.toml",
    logValue(value: boolean | string) {
      if (value === true) return "wrangler.toml";
      if (value === false) return undefined;
      return path.relative("", value);
    },
  })
  wranglerConfigPath?: boolean | string;

  @Option({
    type: OptionType.STRING,
    name: "wrangler-env",
    description: "Environment in wrangler.toml to use",
    logName: "Wrangler Environment",
  })
  wranglerConfigEnv?: string;

  @Option({
    type: OptionType.STRING,
    name: "package",
    description: "Path to package.json",
    logValue(value: boolean | string) {
      if (value === true) return "package.json";
      if (value === false) return undefined;
      return path.relative("", value);
    },
  })
  packagePath?: boolean | string;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "m",
    description: "Enable modules",
    fromWrangler: ({ build }) =>
      build?.upload?.format && build.upload.format === "modules",
  })
  modules?: boolean;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "TYPE=GLOB",
    description: "Modules import rule",
    logValue: (value: ModuleRule[]) =>
      value
        .map((rule) => `{${rule.type}: ${rule.include.join(", ")}}`)
        .join(", "),
    fromEntries: (entries) =>
      entries.map<ModuleRule>(([type, include]) => ({
        type: type as ModuleRuleType,
        include: [include],
        fallthrough: true,
      })),
    fromWrangler: ({ build }) =>
      build?.upload?.rules?.map(({ type, globs, fallthrough }) => ({
        type,
        include: globs,
        fallthrough,
      })),
  })
  modulesRules?: ModuleRule[];

  @Option({
    type: OptionType.STRING,
    name: "compat-date",
    description: "Opt into backwards-incompatible changes from",
    fromWrangler: ({ compatibility_date }) => compatibility_date,
  })
  compatibilityDate?: string;

  @Option({
    type: OptionType.ARRAY,
    name: "compat-flag",
    description: "Control specific backwards-incompatible changes",
    fromWrangler: ({ compatibility_flags }) => compatibility_flags,
  })
  compatibilityFlags?: CompatibilityFlag[];

  @Option({
    type: OptionType.STRING,
    name: "usage-model",
    description: "Usage model (bundled by default)",
    fromWrangler: ({ usage_model }) => usage_model,
  })
  usageModel?: "bundled" | "unbound";

  @Option({
    type: OptionType.STRING,
    alias: "u",
    description: "URL of upstream origin",
    fromWrangler: ({ miniflare }) => miniflare?.upstream,
  })
  upstream?: string;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "w",
    description: "Watch files for changes",
    fromWrangler: ({ miniflare }) => {
      if (miniflare?.watch !== undefined) return miniflare.watch;
      if (miniflare?.live_reload) return true;
    },
  })
  watch?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "d",
    description: "Enable debug logging",
  })
  debug?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "V",
    description: "Enable verbose logging",
  })
  verbose?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Enable update checker (enabled by default)",
    negatable: true,
    fromWrangler: ({ miniflare }) => miniflare?.update_check,
  })
  updateCheck?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    logName: "REPL",
    description: "Enable interactive REPL",
  })
  repl?: boolean;

  @Option({
    type: OptionType.STRING,
    name: "root",
    description: "Path to resolve files relative to",
  })
  rootPath?: string;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=PATH[@ENV]",
    description: "Mount additional named workers",
    fromEntries: (entries) =>
      Object.fromEntries(entries.map((entry) => mapMountEntries(entry))),
    fromWrangler: ({ miniflare }, configDir) =>
      miniflare?.mounts &&
      Object.fromEntries(
        Object.entries(miniflare.mounts).map((entry) =>
          mapMountEntries(entry, configDir)
        )
      ),
  })
  mounts?: Record<string, string | CoreOptions | BindingsOptions>;

  @Option({
    type: OptionType.STRING,
    description: "Name of service",
    fromWrangler: ({ name }) => name,
  })
  name?: string;

  @Option({
    type: OptionType.ARRAY,
    description: "Route to respond with this worker on",
    fromWrangler: ({ route, routes, miniflare }) => {
      const result: RouteType[] = [];
      const toPattern = (route: RouteType): string =>
        typeof route === "string" ? route : route.pattern;
      if (route) result.push(route);
      if (routes) result.push(...routes);
      if (miniflare?.route) result.push(miniflare.route);
      if (miniflare?.routes) result.push(...miniflare.routes);
      return result.length ? result.map(toPattern) : undefined;
    },
  })
  routes?: string[];

  @Option({ type: OptionType.NONE })
  logUnhandledRejections?: boolean;

  @Option({ type: OptionType.NONE })
  fetchMock?: MockAgent;

  @Option({
    type: OptionType.BOOLEAN,
    name: "global-async-io",
    description: "Allow async I/O outside handlers",
    logName: "Allow Global Async I/O",
    fromWrangler: ({ miniflare }) => miniflare?.global_async_io,
  })
  globalAsyncIO?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Allow setting timers outside handlers",
    logName: "Allow Global Timers",
    fromWrangler: ({ miniflare }) => miniflare?.global_timers,
  })
  globalTimers?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Allow secure random generation outside handlers",
    logName: "Allow Global Secure Random",
    fromWrangler: ({ miniflare }) => miniflare?.global_random,
  })
  globalRandom?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Always return correct time from Date methods",
    fromWrangler: ({ miniflare }) => miniflare?.actual_time,
  })
  actualTime?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Log inaccurate CPU time measurements",
    logName: "Inaccurate CPU Time Measurements",
    fromWrangler: ({ miniflare }) => miniflare?.inaccurate_cpu,
  })
  inaccurateCpu?: boolean;

  readonly processedModuleRules: ProcessedModuleRule[] = [];

  readonly upstreamURL?: URL;
  readonly #globals: Context;
  readonly #additionalModules?: AdditionalModules;

  constructor(ctx: PluginContext, options?: CoreOptions) {
    super(ctx);
    this.assignOptions(options);
    if (this.mounts && Object.keys(this.mounts).length) {
      ctx.log.warn(
        "Mounts are experimental. There may be breaking changes in the future."
      );
    }

    const nodejsCompat = ctx.compat.isEnabled("nodejs_compat");
    if (nodejsCompat) {
      const experimental = ctx.compat.isEnabled("experimental");
      this.#additionalModules = additionalNodeModules(experimental);
    }

    const extraGlobals: Context = {};

    // Make sure the kFormDataFiles flag is set correctly when constructing
    let CompatRequest = Request;
    let CompatResponse = Response;
    if (!ctx.compat.isEnabled("formdata_parser_supports_files")) {
      CompatRequest = proxyStringFormDataFiles(Request);
      CompatResponse = proxyStringFormDataFiles(Response);
    }

    // Only include `navigator` if `global_navigator` compatibility flag is set
    if (ctx.compat.isEnabled("global_navigator")) {
      extraGlobals.navigator = new Navigator();
      extraGlobals.Navigator = Navigator;
    }

    const enableStreamConstructors = ctx.compat.isEnabled(
      "streams_enable_constructors"
    );
    const enableTransformStreamConstructor = ctx.compat.isEnabled(
      "transformstream_enable_standard_constructor"
    );
    let CompatReadableStream = ReadableStream;
    let CompatWritableStream = WritableStream;
    let CompatTransformStream:
      | typeof TransformStream
      | typeof IdentityTransformStream = TransformStream;
    // Disable stream constructors if `streams_enable_constructors`
    // compatibility flag not set
    if (!enableStreamConstructors) {
      CompatReadableStream = proxyDisableStreamConstructor(ReadableStream);
      CompatWritableStream = proxyDisableStreamConstructor(WritableStream);
      // If `transformstream_enable_standard_constructor` flag set, but
      // `streams_enable_constructors` not set, disable `TransformStream`
      // constructor
      if (enableTransformStreamConstructor) {
        CompatTransformStream = proxyDisableStreamConstructor(TransformStream);
      }
    }
    // If `transformstream_enable_standard_constructor` flag not set, use
    // non-spec `IdentityTransformStream` implementation instead
    if (!enableTransformStreamConstructor) {
      CompatTransformStream = new Proxy(IdentityTransformStream, {
        construct(target, args, newTarget) {
          if (args.length > 0) {
            ctx.log.warn(
              "To use the new TransformStream() constructor with a custom transformer, enable the transformstream_enable_standard_constructor feature flag."
            );
          }
          return Reflect.construct(target, args, newTarget);
        },
      });
    }

    // Only include stream controllers if constructors enabled
    if (enableStreamConstructors) {
      extraGlobals.ReadableByteStreamController = ReadableByteStreamController;
      extraGlobals.ReadableStreamBYOBRequest = ReadableStreamBYOBRequest;
      extraGlobals.ReadableStreamDefaultController =
        ReadableStreamDefaultController;
      extraGlobals.WritableStreamDefaultController =
        WritableStreamDefaultController;

      if (enableTransformStreamConstructor) {
        extraGlobals.TransformStreamDefaultController =
          TransformStreamDefaultController;
      }
    }

    // Try to parse upstream URL if set
    try {
      this.upstreamURL =
        this.upstream === undefined ? undefined : new URL(this.upstream);
    } catch (e: any) {
      // Throw with a more helpful error message
      throw new MiniflareCoreError(
        "ERR_INVALID_UPSTREAM",
        `Invalid upstream URL: \"${this.upstream}\". Make sure you've included the protocol.`
      );
    }

    const blockGlobalTimers = !this.globalTimers;
    const crypto = createCrypto(!this.globalRandom);

    // `(De)CompressionStream`s were added in Node.js 17.0.0, and added to the
    // global scope in Node.js 18.0.0. Our minimum supported version is 16.13.0,
    // so we implement basic versions ourselves, preferring Node's if available.
    const CompressionStreamImpl =
      webStreams.CompressionStream ?? CompressionStream;
    const DecompressionStreamImpl =
      webStreams.DecompressionStream ?? DecompressionStream;

    if (this.inaccurateCpu) {
      ctx.log.warn(
        "CPU time measurements are experimental, highly inaccurate and not representative of deployed worker performance.\n" +
          "They should only be used for relative comparisons and may be removed in the future."
      );
    }

    // Build globals object
    // noinspection JSDeprecatedSymbols
    this.#globals = {
      console,

      setTimeout: createTimer(setTimeout, blockGlobalTimers),
      setInterval: createTimer(setInterval, blockGlobalTimers),
      clearTimeout: assertsInRequest(clearTimeout, blockGlobalTimers),
      clearInterval: assertsInRequest(clearInterval, blockGlobalTimers),
      queueMicrotask,
      scheduler: new Scheduler(blockGlobalTimers),

      atob,
      btoa,

      // We shouldn't need to include this, but it seems to be missing when
      // running scripts for module exports in Miniflare's Jest environment
      // otherwise. See https://github.com/cloudflare/miniflare/pull/129 and
      // https://github.com/mrbbot/miniflare-typescript-esbuild-jest/pull/4 for
      // a reproduction.
      // TODO (someday): work out what's actually going on here
      Math,

      crypto,
      CryptoKey,
      TextDecoder,
      TextEncoder,

      fetch: createCompatFetch(ctx, fetch.bind(this.fetchMock)),
      Headers,
      Request: CompatRequest,
      Response: CompatResponse,
      FormData,
      Blob,
      File,
      URL,
      URLSearchParams,
      URLPattern,

      ReadableStream: CompatReadableStream,
      WritableStream: CompatWritableStream,
      TransformStream: CompatTransformStream,

      ReadableStreamBYOBReader,
      ReadableStreamDefaultReader,
      WritableStreamDefaultWriter,

      ByteLengthQueuingStrategy,
      CountQueuingStrategy,

      IdentityTransformStream,
      FixedLengthStream,

      CompressionStream: CompressionStreamImpl,
      DecompressionStream: DecompressionStreamImpl,
      TextEncoderStream,
      TextDecoderStream,

      Event,
      EventTarget,
      AbortController,
      AbortSignal,

      FetchEvent,
      ScheduledEvent,

      DOMException,
      WorkerGlobalScope,

      // `structuredClone` was added to the global scope in Node 17.0.0.
      structuredClone: globalThis.structuredClone ?? structuredCloneImpl,

      Date: createDate(this.actualTime),

      ...extraGlobals,

      // The types below would be included automatically, but it's not possible
      // to create instances of them without using their constructors and they
      // may be returned from Miniflare's realm (e.g. ArrayBuffer responses,
      // Durable Object listed keys) so it makes sense to share these so
      // instanceof behaves correctly.
      ArrayBuffer,
      Atomics,
      BigInt64Array,
      BigUint64Array,
      DataView,
      Float32Array,
      Float64Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Map,
      Set,
      SharedArrayBuffer,
      Uint8Array,
      Uint8ClampedArray,
      Uint16Array,
      Uint32Array,
      WeakMap,
      WeakSet,
      WebAssembly,

      // Add a global variable to signal the worker is running in Miniflare,
      // could be used as an escape hatch if behaviour needs to be different
      // locally for any reason
      MINIFLARE: true,

      // Object, Function, Array, Promise, RegExp, Error, EvalError, RangeError,
      // ReferenceError, SyntaxError, TypeError and URIError are intentionally
      // omitted. See packages/runner-vm/src/instanceof.ts for a detailed
      // explanation of why.
    };

    // Process module rules if modules mode was enabled
    if (!this.modules) return;
    const finalisedTypes = new Set<ModuleRuleType>();
    for (const rule of [
      ...(this.modulesRules ?? []),
      ...DEFAULT_MODULE_RULES,
    ]) {
      // Ignore rule if type didn't enable fallthrough
      if (finalisedTypes.has(rule.type)) continue;
      this.processedModuleRules.push({
        type: rule.type,
        include: globsToMatcher(rule.include),
      });
      if (!rule.fallthrough) finalisedTypes.add(rule.type);
    }
  }

  async setup(): Promise<SetupResult> {
    const globals = this.#globals;
    const additionalModules = this.#additionalModules;

    // First, try to load script from string, no need to watch any files
    if (this.script !== undefined) {
      return {
        globals,
        additionalModules,
        script: {
          filePath: this.scriptPath ?? STRING_SCRIPT_PATH,
          code: this.script,
        },
      };
    }

    const watch: string[] = [];
    let scriptPath = this.scriptPath;

    // If there's no script path from options or wrangler config, try get it
    // from package.json
    if (scriptPath === undefined) {
      let packagePath =
        this.packagePath === true ? "package.json" : this.packagePath;
      if (packagePath) {
        packagePath = path.resolve(this.ctx.rootPath, packagePath);
        try {
          const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
          scriptPath = this.modules ? pkg.module : pkg.main;
          scriptPath &&= path.resolve(path.dirname(packagePath), scriptPath);
        } catch (e: any) {
          // Ignore ENOENT (file not found) errors for default path
          if (!(e.code === "ENOENT" && this.packagePath === true)) throw e;
        }
        watch.push(packagePath);
      }
    }

    // If we managed to get a script path from options, wrangler config or
    // package.json, load it
    if (scriptPath !== undefined) {
      scriptPath = path.resolve(this.ctx.rootPath, scriptPath);
      const code = await fs.readFile(scriptPath, "utf8");
      watch.push(scriptPath);
      return {
        globals,
        additionalModules,
        script: { filePath: scriptPath, code },
        watch,
      };
    }

    // If we couldn't load a script yet, keep watching package.json anyways, it
    // might get edited with a path
    return { globals, additionalModules, watch };
  }
}
