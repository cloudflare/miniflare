import { promises as fs, readFileSync } from "fs";
import path from "path";
import vm from "vm";
import {
  Context,
  ProcessedModuleRule,
  STRING_SCRIPT_PATH,
  viewToBuffer,
} from "@miniflare/shared";
import { VMScriptRunnerError } from "./error";

interface CommonJSModule {
  exports: any;
}

export class ModuleLinker {
  private readonly referencedPathSizes = new Map<string, number>();
  private readonly moduleCache = new Map<string, vm.Module>();
  private readonly cjsModuleCache = new Map<string, CommonJSModule>();

  constructor(private moduleRules: ProcessedModuleRule[]) {
    this.linker = this.linker.bind(this);
  }

  get referencedPaths(): IterableIterator<string> {
    return this.referencedPathSizes.keys();
  }

  get referencedPathsTotalSize(): number {
    // Make sure we only include each module once, even if it's referenced
    // from multiple scripts
    const sizes = Array.from(this.referencedPathSizes.values());
    return sizes.reduce((total, size) => total + size, 0);
  }

  async linker(spec: string, referencing: vm.Module): Promise<vm.Module> {
    const relative = path.relative("", referencing.identifier);
    const errorBase = `Unable to resolve "${relative}" dependency "${spec}"`;

    if (referencing.identifier === STRING_SCRIPT_PATH) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_STRING_SCRIPT",
        `${errorBase}: imports unsupported with string script`
      );
    }

    // Get path to specified module relative to referencing module
    const identifier = path.resolve(path.dirname(referencing.identifier), spec);
    // If we've already seen a module with the same identifier, return it, to
    // handle import cycles
    const cached = this.moduleCache.get(identifier);
    if (cached) return cached;

    // Find first matching module rule ("ignore" requires relative paths)
    const relativeIdentifier = path.relative("", identifier);
    const rule = this.moduleRules.find((rule) =>
      rule.include.test(relativeIdentifier)
    );
    if (rule === undefined) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_RULE",
        `${errorBase}: no matching module rules`
      );
    }

    // Load module based on rule type
    const data = await fs.readFile(identifier);
    this.referencedPathSizes.set(identifier, data.byteLength);
    const moduleOptions = { identifier, context: referencing.context };
    let module: vm.Module;
    switch (rule.type) {
      case "ESModule":
        module = new vm.SourceTextModule(data.toString("utf8"), moduleOptions);
        break;
      case "CommonJS":
        const exports = this.loadCommonJSModule(
          errorBase,
          identifier,
          referencing.context
        );
        module = new vm.SyntheticModule<{ default: Context }>(
          ["default"],
          function () {
            this.setExport("default", exports);
          },
          moduleOptions
        );
        break;
      case "Text":
        module = new vm.SyntheticModule<{ default: string }>(
          ["default"],
          function () {
            this.setExport("default", data.toString("utf8"));
          },
          moduleOptions
        );
        break;
      case "Data":
        module = new vm.SyntheticModule<{ default: ArrayBuffer }>(
          ["default"],
          function () {
            this.setExport("default", viewToBuffer(data));
          },
          moduleOptions
        );
        break;
      case "CompiledWasm":
        module = new vm.SyntheticModule<{ default: WebAssembly.Module }>(
          ["default"],
          function () {
            this.setExport("default", new WebAssembly.Module(data));
          },
          moduleOptions
        );
        break;
      default:
        throw new VMScriptRunnerError(
          "ERR_MODULE_UNSUPPORTED",
          `${errorBase}: ${rule.type} modules are unsupported`
        );
    }
    this.moduleCache.set(identifier, module);
    return module;
  }

  private loadCommonJSModule(
    errorBase: string,
    identifier: string,
    context: vm.Context
  ): any {
    // If we've already seen a module with the same identifier, return it, to
    // handle import cycles
    const cached = this.cjsModuleCache.get(identifier);
    if (cached) return cached;

    // Find first matching module rule ("ignore" requires relative paths)
    const relativeIdentifier = path.relative("", identifier);
    const rule = this.moduleRules.find((rule) =>
      rule.include.test(relativeIdentifier)
    );
    if (rule === undefined) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_RULE",
        `${errorBase}: no matching module rules`
      );
    }

    // Create module and store in cache now as require is sync, so may load
    // this module again before this function returns
    const module: CommonJSModule = { exports: {} };
    this.cjsModuleCache.set(identifier, module);

    // Load module based on rule type
    const data = readFileSync(identifier);
    this.referencedPathSizes.set(identifier, data.byteLength);
    switch (rule.type) {
      case "ESModule":
        throw new VMScriptRunnerError(
          "ERR_CJS_MODULE_UNSUPPORTED",
          `${errorBase}: CommonJS modules cannot require ES modules`
        );
      case "CommonJS":
        const code = data.toString("utf8");
        const wrapped = `(function(exports, require, module) {\n${code}\n});`;
        const script = new vm.Script(wrapped, {
          filename: identifier,
          lineOffset: -1, // Ignore function(...) line
        });
        const moduleWrapper = script.runInContext(context);

        const require = this.createRequire(identifier, context);
        moduleWrapper(module.exports, require, module);
        break;
      // TODO: check we can actually import these other types from CJS
      case "Text":
        module.exports = data.toString("utf8");
        break;
      case "Data":
        module.exports = viewToBuffer(data);
        break;
      case "CompiledWasm":
        module.exports = new WebAssembly.Module(data);
        break;
      default:
        throw new VMScriptRunnerError(
          "ERR_MODULE_UNSUPPORTED",
          `${errorBase}: ${rule.type} modules are unsupported`
        );
    }
    return module.exports;
  }

  private createRequire(referencingIdentifier: string, context: vm.Context) {
    const relative = path.relative("", referencingIdentifier);
    const referencingDirname = path.dirname(referencingIdentifier);
    return (spec: string): Context => {
      const errorBase = `Unable to resolve "${relative}" dependency "${spec}"`;
      // Get path to specified module relative to referencing module
      const identifier = path.resolve(referencingDirname, spec);
      return this.loadCommonJSModule(errorBase, identifier, context);
    };
  }
}
