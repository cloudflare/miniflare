import { promises as fs } from "fs";
import {
  Context,
  Log,
  Option,
  OptionType,
  Plugin,
  SetupResult,
} from "@miniflare/shared";
import dotenv from "dotenv";

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
    logValue: (value: boolean | string) =>
      value === true ? ".env" : value.toString(),
    fromWrangler: ({ miniflare }) => miniflare?.env_path,
  })
  envPath?: boolean | string;

  @Option({
    type: OptionType.OBJECT,
    alias: "b",
    description: "Binds variable/secret to environment",
    logName: "Custom Bindings",
    fromWrangler: ({ vars }) => {
      if (!vars) return;
      // Wrangler stringifies all environment variables
      return Object.fromEntries(
        Object.entries(vars).map(([key, value]) => [key, String(value)])
      );
    },
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
    // TODO: change to wasm_modules, wrangler issue #1716
    fromWrangler: ({ miniflare }) =>
      miniflare?.wasm_bindings?.reduce((bindings, { name, path }) => {
        bindings[name] = path;
        return bindings;
      }, {} as Record<string, string>),
  })
  wasmBindings?: Record<string, string>;

  constructor(
    log: Log,
    options?: BindingsOptions,
    private readonly defaultEnvPath: string = ".env"
  ) {
    super(log);
    this.assignOptions(options);
  }

  async setup(): Promise<SetupResult> {
    const bindings: Context = {};
    const watch: string[] = [];

    // Load bindings from .env file
    const envPath = this.envPath === true ? this.defaultEnvPath : this.envPath;
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
