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
    description: "Bind variable/secret",
    logName: "Custom Bindings",
    fromWrangler: ({ vars }) => vars,
  })
  bindings?: Record<string, any>;

  @Option({
    type: OptionType.OBJECT,
    typeFormat: "NAME=PATH",
    name: "wasm",
    description: "WASM module to bind",
    logName: "WASM Bindings",
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

    // Copy user's arbitrary bindings
    Object.assign(bindings, this.bindings);

    // Load WebAssembly module bindings from files
    if (this.wasmBindings) {
      for (const [name, wasmPath] of Object.entries(this.wasmBindings)) {
        bindings[name] = new WebAssembly.Module(await fs.readFile(wasmPath));
        watch.push(wasmPath);
      }
    }

    return { bindings, watch };
  }
}
