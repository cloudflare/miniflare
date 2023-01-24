import vm from "vm";
import {
  AdditionalModules,
  Compatibility,
  Context,
  ProcessedModuleRule,
  ScriptBlueprint,
  ScriptRunner,
  ScriptRunnerResult,
} from "@miniflare/shared";
import { VMScriptRunnerError } from "./error";
import { defineHasInstances } from "./instanceof";
import { ModuleLinker } from "./linker";

export * from "./error";
export * from "./instanceof";

// noinspection JSMethodCanBeStatic
export class VMScriptRunner implements ScriptRunner {
  constructor(private context?: vm.Context) {}

  private runAsScript(context: vm.Context, blueprint: ScriptBlueprint) {
    const script = new vm.Script(blueprint.code, {
      filename: blueprint.filePath,
    });
    script.runInContext(context);
  }

  private async runAsModule(
    context: vm.Context,
    blueprint: ScriptBlueprint,
    linker: ModuleLinker
  ): Promise<Context> {
    const module = new vm.SourceTextModule(blueprint.code, {
      identifier: blueprint.filePath,
      context,
      importModuleDynamically: linker.importModuleDynamically,
    });
    await module.link(linker.linker);
    await module.evaluate();
    return module.namespace;
  }

  async run(
    globalScope: Context,
    blueprint: ScriptBlueprint,
    modulesRules?: ProcessedModuleRule[],
    additionalModules?: AdditionalModules,
    compat?: Compatibility
  ): Promise<ScriptRunnerResult> {
    // If we're using modules, make sure --experimental-vm-modules is enabled
    if (modulesRules && !("SourceTextModule" in vm)) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_DISABLED",
        "Modules support requires the --experimental-vm-modules flag"
      );
    }
    // Also build a linker if we're using modules
    const linker =
      modulesRules &&
      new ModuleLinker(modulesRules, additionalModules ?? {}, compat);

    let context = this.context;
    if (context) {
      // This path is for custom test environments, where this.context is only
      // used once.
      Object.assign(context, globalScope);
    } else {
      // Create a new context with eval/new Function/WASM compile disabled
      context = vm.createContext(globalScope, {
        codeGeneration: { strings: false, wasm: false },
      });
    }
    // Define custom [Symbol.hasInstance]s for primitives so cross-realm
    // instanceof works correctly.
    defineHasInstances(context);

    // Keep track of module namespaces and total script size
    let exports: Context = {};
    let bundleSize = 0;

    bundleSize += Buffer.byteLength(blueprint.code);
    if (linker) {
      // If we have a linker, we must've passed module rules so run as module,
      // storing exported namespace
      exports = await this.runAsModule(context, blueprint, linker);
    } else {
      this.runAsScript(context, blueprint);
    }

    // Add referenced modules to total script size and watched paths
    if (linker) bundleSize += linker.referencedPathsTotalSize;
    const watch = linker && [...linker.referencedPaths];

    return { exports, bundleSize, watch };
  }
}
