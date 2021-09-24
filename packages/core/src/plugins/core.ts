import { promises as fs } from "fs";
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
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} from "stream/web";
import { URL, URLSearchParams } from "url";
import { TextEncoder } from "util";
import {
  Context,
  Log,
  ModuleRule,
  ModuleRuleType,
  Option,
  OptionType,
  Plugin,
  ProcessedModuleRule,
  STRING_SCRIPT_PATH,
  SetupResult,
  globsToMatcher,
} from "@miniflare/shared";
import { WebSocket } from "@miniflare/web-sockets";
import { FormData, Headers } from "undici";
import {
  DOMException,
  FetchEvent,
  Request,
  RequestInfo,
  RequestInit,
  Response,
  ScheduledEvent,
  TextDecoder,
  WorkerGlobalScope,
  crypto,
  fetch,
} from "../standards";

const DEFAULT_MODULE_RULES: ModuleRule[] = [
  { type: "ESModule", include: ["**/*.mjs"] },
  { type: "CommonJS", include: ["**/*.js", "**/*.cjs"] },
];

const kGlobals = Symbol("kGlobals");
const kMainScriptPath = Symbol("kMainScriptPath");
const kWebSockets = Symbol("kWebSockets");

export interface CoreOptions {
  script?: string;
  scriptPath?: string;
  packagePath?: boolean | string;
  wranglerConfigPath?: boolean | string;
  wranglerConfigEnv?: string;
  modules?: boolean;
  modulesRules?: ModuleRule[];
  upstream?: string;
  watch?: boolean;
  debug?: boolean;
  verbose?: boolean;
}

export class CorePlugin extends Plugin<CoreOptions> implements CoreOptions {
  // Both script and scriptPath are optional, this allows us not to pass a
  // script for testing (e.g. Jest environment). The CLI should error if no
  // script is passed though.
  @Option({ type: OptionType.NONE })
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
    logValue: (value: boolean | string) =>
      value === true ? "wrangler.toml" : value.toString(),
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
    logValue: (value: boolean | string) =>
      value === true ? "package.json" : value.toString(),
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
    alias: "u",
    description: "URL of upstream origin",
    fromWrangler: ({ miniflare }) => miniflare?.upstream,
  })
  upstream?: string;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "w",
    description: "Watch files for changes",
    fromWrangler: ({ miniflare }) => miniflare?.watch,
  })
  watch?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "d",
    description: "Enable debug logging",
    fromWrangler: ({ miniflare }) => miniflare?.debug,
  })
  debug?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    description: "Enable verbose logging",
    fromWrangler: ({ miniflare }) => miniflare?.verbose,
  })
  verbose?: boolean;

  readonly processedModuleRules: ProcessedModuleRule[] = [];

  private readonly [kGlobals]: Context;
  private [kMainScriptPath]?: string;
  private [kWebSockets] = new Set<WebSocket>();

  constructor(
    log: Log,
    options?: CoreOptions,
    private readonly defaultPackagePath = "package.json"
  ) {
    super(log);
    this.assignOptions(options);

    // Build globals object
    this[kGlobals] = {
      console,

      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,

      atob,
      btoa,

      crypto,
      CryptoKey: crypto.CryptoKey,
      TextDecoder,
      TextEncoder,

      fetch: this.fetch.bind(this),
      Headers,
      Request,
      Response,
      FormData,
      URL,
      URLSearchParams,

      ByteLengthQueuingStrategy,
      CountQueuingStrategy,
      ReadableByteStreamController,
      ReadableStream,
      ReadableStreamBYOBReader,
      ReadableStreamBYOBRequest,
      ReadableStreamDefaultController,
      ReadableStreamDefaultReader,
      TransformStream,
      TransformStreamDefaultController,
      WritableStream,
      WritableStreamDefaultController,
      WritableStreamDefaultWriter,

      Event,
      EventTarget,
      FetchEvent,
      ScheduledEvent,

      DOMException,
      WorkerGlobalScope,

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
      Date,
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

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const response = await fetch(input, init);
    if (response.webSocket) this[kWebSockets].add(response.webSocket);
    return response;
  }

  get mainScriptPath(): string | undefined {
    return this[kMainScriptPath];
  }

  async setup(): Promise<SetupResult> {
    const globals = this[kGlobals];
    this[kMainScriptPath] = undefined;

    // First, try to load script from string, no need to watch any files
    if (this.script !== undefined) {
      this[kMainScriptPath] = STRING_SCRIPT_PATH;
      return {
        globals,
        scripts: [{ filePath: STRING_SCRIPT_PATH, code: this.script }],
      };
    }

    const watch: string[] = [];
    let scriptPath = this.scriptPath;

    // If there's no script path from options or wrangler config, try get it
    // from package.json
    if (scriptPath === undefined) {
      const packagePath =
        this.packagePath === true ? this.defaultPackagePath : this.packagePath;
      if (packagePath) {
        try {
          const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
          scriptPath = this.modules ? pkg.modules : pkg.main;
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
      scriptPath = path.resolve(scriptPath);
      const code = await fs.readFile(scriptPath, "utf8");
      watch.push(scriptPath);
      this[kMainScriptPath] = scriptPath;
      return { globals, scripts: [{ filePath: scriptPath, code }], watch };
    }

    // If we couldn't load a script yet, keep watching package.json anyways, it
    // might get edited with a path
    return { globals, watch };
  }

  reload(): void {
    // Ensure all fetched web sockets are closed
    for (const ws of this[kWebSockets]) {
      ws.close(1012, "Service Restart");
    }
    this[kWebSockets].clear();
  }

  dispose(): void {
    return this.reload();
  }
}
