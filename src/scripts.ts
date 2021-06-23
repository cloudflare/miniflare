import { promises as fs } from "fs";
import path from "path";
import vm from "vm";
import { cjsToEsm } from "cjstoesm";
import { ModuleKind, TranspileOptions, transpileModule } from "typescript";
import { Context } from "./modules/module";
import { ProcessedModuleRule, stringScriptPath } from "./options";

export class ScriptBlueprint {
  constructor(private code: string, public fileName: string) {}

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
      throw new Error(
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

const commonJsTranspileOptions: TranspileOptions = {
  transformers: cjsToEsm(),
  compilerOptions: {
    allowJs: true,
    module: ModuleKind.ESNext,
  },
};

export function buildLinker(
  moduleRules: ProcessedModuleRule[]
): vm.ModuleLinker {
  return async (specifier, referencingModule) => {
    const errorBase = `Unable to resolve "${path.relative(
      "",
      referencingModule.identifier
    )}" dependency "${specifier}"`;

    if (referencingModule.identifier === stringScriptPath) {
      throw new Error(`${errorBase}: imports unsupported with string script`);
    }

    // Get path to specified module relative to referencing module and make
    // sure it's within the root modules path
    const modulePath = path.resolve(
      path.dirname(referencingModule.identifier),
      specifier
    );

    // Find first matching module rule
    const rule = moduleRules.find((rule) =>
      rule.include.some((regexp) => modulePath.match(regexp))
    );
    if (rule === undefined) {
      throw new Error(`${errorBase}: no matching module rules`);
    }

    // Load module based on rule type
    const data = await fs.readFile(modulePath);
    const moduleOptions = {
      identifier: modulePath,
      context: referencingModule.context,
    };
    switch (rule.type) {
      case "ESModule":
        return new vm.SourceTextModule(data.toString("utf8"), moduleOptions);
      case "CommonJS":
        // TODO: try do this without TypeScript
        const transpiled = transpileModule(
          data.toString("utf8"),
          commonJsTranspileOptions
        );
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
        throw new Error(`${errorBase}: ${rule.type} modules are unsupported`);
    }
  };
}
