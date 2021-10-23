import { Blob } from "buffer";
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
import { File, FormData } from "undici";
import {
  DOMException,
  FetchEvent,
  Headers,
  Request,
  Response,
  ScheduledEvent,
  TextDecoder,
  WorkerGlobalScope,
  crypto,
  gatedFetch,
  inputGatedSetInterval,
  inputGatedSetTimeout,
} from "../standards";

const DEFAULT_MODULE_RULES: ModuleRule[] = [
  { type: "ESModule", include: ["**/*.mjs"] },
  { type: "CommonJS", include: ["**/*.js", "**/*.cjs"] },
];

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
  })
  debug?: boolean;

  @Option({
    type: OptionType.BOOLEAN,
    alias: "V",
    description: "Enable verbose logging",
  })
  verbose?: boolean;

  readonly processedModuleRules: ProcessedModuleRule[] = [];

  readonly #globals: Context;

  constructor(
    log: Log,
    options?: CoreOptions,
    private readonly defaultPackagePath = "package.json"
  ) {
    super(log);
    this.assignOptions(options);

    // Build globals object
    this.#globals = {
      console,

      setTimeout: inputGatedSetTimeout,
      setInterval: inputGatedSetInterval,
      clearTimeout,
      clearInterval,

      atob,
      btoa,

      crypto,
      CryptoKey: crypto.CryptoKey,
      TextDecoder,
      TextEncoder,

      fetch: gatedFetch,
      Headers,
      Request,
      Response,
      FormData,
      Blob,
      File,
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
      AbortController,
      AbortSignal,
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

      // Add a global variable to signal the worker is running in Miniflare,
      // could be used as an escape hatch if behaviour needs to be different
      // locally for any reason
      MINIFLARE: true,
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

    // First, try to load script from string, no need to watch any files
    if (this.script !== undefined) {
      return {
        globals,
        script: { filePath: STRING_SCRIPT_PATH, code: this.script },
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
      scriptPath = path.resolve(scriptPath);
      const code = await fs.readFile(scriptPath, "utf8");
      watch.push(scriptPath);
      return { globals, script: { filePath: scriptPath, code }, watch };
    }

    // If we couldn't load a script yet, keep watching package.json anyways, it
    // might get edited with a path
    return { globals, watch };
  }
}
