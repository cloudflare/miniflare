import { promises as fs } from "fs";
import path from "path";
import vm from "vm";
import { Context } from "./modules/module";
import { ProcessedModuleRule, relativePath } from "./options";

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

  async buildModule(
    context: Context,
    linker: vm.ModuleLinker
  ): Promise<ModuleScriptInstance> {
    const vmContext = ScriptBlueprint._createContext(context);
    const module = new vm.SourceTextModule(this.code, {
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

export class ModuleScriptInstance implements ScriptInstance {
  constructor(private module: vm.SourceTextModule) {}

  async run(): Promise<void> {
    await this.module.evaluate({ breakOnSigint: true });
  }

  get namespace(): any {
    return this.module.namespace;
  }
}

export function buildLinker(
  moduleRules: ProcessedModuleRule[]
): vm.ModuleLinker {
  return async (specifier, referencingModule) => {
    const errorBase = `Unable to resolve "${relativePath(
      referencingModule.identifier
    )}" dependency "${specifier}"`;

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
            this.setExport("default", data.buffer);
          },
          moduleOptions
        );
      // TODO: add support for CompiledWasm modules (and maybe CommonJS)
      //  https://developers.cloudflare.com/workers/cli-wrangler/configuration#buildupload
      default:
        throw new Error(`${errorBase}: ${rule.type} modules are unsupported`);
    }
  };
}
