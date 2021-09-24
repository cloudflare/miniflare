import vm from "vm";
import {
  Context,
  ModuleExports,
  ProcessedModuleRule,
  ScriptBlueprint,
  ScriptRunner,
  ScriptRunnerResult,
} from "@miniflare/shared";
import { VMScriptRunnerError } from "./error";
import { ModuleLinker } from "./linker";
import { proxiedGlobals } from "./proxied";

// noinspection JSMethodCanBeStatic
export class VMScriptRunner implements ScriptRunner {
  private runAsScript(context: vm.Context, blueprint: ScriptBlueprint) {
    const script = new vm.Script(blueprint.code, {
      filename: blueprint.filePath,
    });
    script.runInContext(context);
  }

  private async runAsModule(
    context: vm.Context,
    blueprint: ScriptBlueprint,
    linker: vm.ModuleLinker
  ): Promise<Context> {
    const module = new vm.SourceTextModule(blueprint.code, {
      identifier: blueprint.filePath,
      context,
    });
    await module.link(linker);
    await module.evaluate();
    return module.namespace;
  }

  async run(
    globalScope: Context,
    blueprints: ScriptBlueprint[],
    modulesRules?: ProcessedModuleRule[]
  ): Promise<ScriptRunnerResult> {
    // If we're using modules, make sure --experimental-vm-modules is enabled
    if (modulesRules && !("SourceTextModule" in vm)) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_DISABLED",
        "Modules support requires the --experimental-vm-modules flag"
      );
    }
    // Also build a linker if we're using modules
    const linker = modulesRules && new ModuleLinker(modulesRules);

    // Add proxied globals so cross-realm instanceof works correctly.
    // globalScope will be fresh for each call of run so it's fine to mutate it.
    Object.assign(globalScope, proxiedGlobals);

    // Create a new shared context with eval/new Function/WASM compile disabled
    const context = vm.createContext(globalScope, {
      codeGeneration: { strings: false, wasm: false },
    });
    // Keep track of module namespaces and total script size
    const exports: ModuleExports = new Map<string, Context>();
    let bundleSize = 0;

    for (const blueprint of blueprints) {
      bundleSize += Buffer.byteLength(blueprint.code);
      if (linker) {
        // If we have a linker, we must've passed module rules so run as module,
        // storing exported namespace
        const namespace = await this.runAsModule(
          context,
          blueprint,
          linker.linker
        );
        exports.set(blueprint.filePath, namespace);
      } else {
        this.runAsScript(context, blueprint);
      }
    }

    // Add referenced modules to total script size and watched paths
    if (linker) bundleSize += linker.referencedPathsTotalSize;
    const watch = linker && [...linker.referencedPaths];

    return { exports, bundleSize, watch };
  }
}
