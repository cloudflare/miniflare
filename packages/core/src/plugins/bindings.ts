import fs from "fs/promises";
import path from "path";
import {
  Context,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
} from "@miniflare/shared";
import dotenv from "dotenv";

const kWranglerBindings = Symbol("kWranglerBindings");

export interface BindingsOptions {
  envPath?: boolean | string;
  envPathDefaultFallback?: boolean;
  bindings?: Record<string, any>;
  globals?: Record<string, any>;
  wasmBindings?: Record<string, string>;
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

  constructor(ctx: PluginContext, options?: BindingsOptions) {
    super(ctx);
    this.assignOptions(options);
    if (this.envPathDefaultFallback && this.envPath === undefined) {
      this.envPath = true;
    }
  }

  async setup(): Promise<SetupResult> {
    // Bindings should be loaded in this order, from lowest to highest priority:
    // 1) Wrangler [vars]
    // 2) .env Variables
    // 3) WASM Module Bindings
    // 4) Custom Bindings

    const bindings: Context = {};
    const watch: string[] = [];

    // Copy Wrangler bindings first
    Object.assign(bindings, this[kWranglerBindings]);

    // Load bindings from .env file
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

    // Load WebAssembly module bindings from files
    if (this.wasmBindings) {
      // eslint-disable-next-line prefer-const
      for (let [name, wasmPath] of Object.entries(this.wasmBindings)) {
        wasmPath = path.resolve(this.ctx.rootPath, wasmPath);
        bindings[name] = new WebAssembly.Module(await fs.readFile(wasmPath));
        watch.push(wasmPath);
      }
    }

    // Copy user's arbitrary bindings
    Object.assign(bindings, this.bindings);

    return { globals: this.globals, bindings, watch };
  }
}
