import assert from "assert";
import { promises as fs } from "fs";
import path from "path";
import vm, { ModuleLinker } from "vm";
import type { CompilerOptions, CustomTransformers } from "typescript";
import { MiniflareError } from "./error";
import { Context } from "./modules/module";
import { ProcessedModuleRule, stringScriptPath } from "./options";

export class ScriptBlueprint {
  constructor(public readonly code: string, public readonly fileName: string) {}

  private static _createContext(context: Context): vm.Context {
    return vm.createContext(context, {
      codeGeneration: { strings: false },
    });
  }

  async buildScript(context: Context): Promise<ScriptScriptInstance> {
    const vmContext = ScriptBlueprint._createContext(context);
    const script = new vm.Script(this.code, { filename: this.fileName });
    return new ScriptScriptInstance(vmContext, script);
  }

  async buildModule<Exports = any>(
    context: Context,
    linker: vm.ModuleLinker
  ): Promise<ModuleScriptInstance<Exports>> {
    const vmContext = ScriptBlueprint._createContext(context);
    if (!("SourceTextModule" in vm)) {
      throw new MiniflareError(
        "Modules support requires the --experimental-vm-modules flag"
      );
    }
    const module = new vm.SourceTextModule<Exports>(this.code, {
      identifier: this.fileName,
      context: vmContext,
    });
    await module.link(linker);
    return new ModuleScriptInstance(module);
  }
}

export interface ScriptInstance {
  run(): Promise<void>;
}

export class ScriptScriptInstance implements ScriptInstance {
  constructor(private context: vm.Context, private script: vm.Script) {}

  async run(): Promise<void> {
    this.script.runInContext(this.context);
  }
}

export class ModuleScriptInstance<Exports = any> implements ScriptInstance {
  constructor(private module: vm.SourceTextModule<Exports>) {}

  async run(): Promise<void> {
    await this.module.evaluate({ breakOnSigint: true });
  }

  get exports(): Exports {
    return this.module.namespace;
  }
}

let cjsTransformer: CustomTransformers | undefined = undefined;
let cjsCompilerOptions: CompilerOptions | undefined = undefined;

export class ScriptLinker {
  readonly referencedPaths = new Set<string>();
  readonly extraSourceMaps = new Map<string, string>();
  readonly linker: ModuleLinker;

  constructor(private moduleRules: ProcessedModuleRule[]) {
    this.linker = this._linker.bind(this);
  }

  private async _linker(
    specifier: string,
    referencingModule: vm.Module
  ): Promise<vm.Module> {
    const errorBase = `Unable to resolve "${path.relative(
      "",
      referencingModule.identifier
    )}" dependency "${specifier}"`;

    if (referencingModule.identifier === stringScriptPath) {
      throw new MiniflareError(
        `${errorBase}: imports unsupported with string script`
      );
    }

    // Get path to specified module relative to referencing module and make
    // sure it's within the root modules path
    const modulePath = path.resolve(
      path.dirname(referencingModule.identifier),
      specifier
    );

    // Find first matching module rule
    const rule = this.moduleRules.find((rule) =>
      rule.include.some((regexp) => modulePath.match(regexp))
    );
    if (rule === undefined) {
      throw new MiniflareError(`${errorBase}: no matching module rules`);
    }

    // Load module based on rule type
    this.referencedPaths.add(modulePath);
    const data = await fs.readFile(modulePath);
    const moduleOptions = {
      identifier: modulePath,
      context: referencingModule.context,
    };
    switch (rule.type) {
      case "ESModule":
        return new vm.SourceTextModule(data.toString("utf8"), moduleOptions);
      case "CommonJS":
        // TODO: (low priority) try do this without TypeScript
        // Dynamically import required packages, `typescript` and `cjstoesm` are
        // pretty big
        const {
          transpileModule,
          ModuleKind,
          ScriptTarget,
          // eslint-disable-next-line @typescript-eslint/no-var-requires
        } = require("typescript");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        cjsTransformer = cjsTransformer ?? require("cjstoesm").cjsToEsm();
        cjsCompilerOptions = cjsCompilerOptions ?? {
          allowJs: true,
          sourceMap: true,
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2018,
        };

        // Convert CommonJS module to an ESModule one
        const transpiled = transpileModule(data.toString("utf8"), {
          transformers: cjsTransformer,
          compilerOptions: cjsCompilerOptions,
          fileName: modulePath,
        });
        // Store ESModule -> CommonJS source map
        assert(transpiled.sourceMapText);
        this.extraSourceMaps.set(modulePath, transpiled.sourceMapText);
        return new vm.SourceTextModule(transpiled.outputText, moduleOptions);
      case "Text":
        return new vm.SyntheticModule<{ default: string }>(
          ["default"],
          function () {
            this.setExport("default", data.toString("utf8"));
          },
          moduleOptions
        );
      case "Data":
        return new vm.SyntheticModule<{ default: ArrayBuffer }>(
          ["default"],
          function () {
            this.setExport(
              "default",
              data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength
              )
            );
          },
          moduleOptions
        );
      case "CompiledWasm":
        return new vm.SyntheticModule<{ default: WebAssembly.Module }>(
          ["default"],
          function () {
            this.setExport("default", new WebAssembly.Module(data));
          },
          moduleOptions
        );
      default:
        throw new MiniflareError(
          `${errorBase}: ${rule.type} modules are unsupported`
        );
    }
  }
}
