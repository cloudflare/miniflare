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
    const envPath =
      this.envPath === true
        ? path.join(this.ctx.rootPath, ".env")
        : this.envPath;
    if (envPath) {
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
      for (const [name, wasmPath] of Object.entries(this.wasmBindings)) {
        bindings[name] = new WebAssembly.Module(await fs.readFile(wasmPath));
        watch.push(wasmPath);
      }
    }

    // Copy user's arbitrary bindings
    Object.assign(bindings, this.bindings);

    return { globals: this.globals, bindings, watch };
  }
}
