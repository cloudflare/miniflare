import { readFileSync } from "fs";
import { builtinModules } from "module";
import path from "path";
import vm, { SourceTextModuleImportModuleDynamically } from "vm";
import {
  AdditionalModules,
  Compatibility,
  Context,
  ProcessedModuleRule,
  STRING_SCRIPT_PATH,
  viewToBuffer,
} from "@miniflare/shared";
import { VMScriptRunnerError } from "./error";

const SUGGEST_BUNDLE =
  "If you're trying to import an npm package, you'll need to bundle your Worker first.";

const SUGGEST_NODE =
  "If you're trying to import a Node.js built-in module, or an npm package " +
  "that uses Node.js built-ins, you'll either need to:" +
  "\n- Bundle your Worker, configuring your bundler to polyfill Node.js built-ins" +
  "\n- Configure your bundler to load Workers-compatible builds by changing the main fields/conditions" +
  "\n- Find an alternative package that doesn't require Node.js built-ins";

interface CommonJSModule {
  exports: any;
}

const linkingPromises = new WeakMap<vm.Module, Promise<vm.Module>>();
const evaluatingPromises = new WeakMap<vm.Module, Promise<void>>();

export class ModuleLinker {
  readonly #referencedPathSizes = new Map<string, number>();
  readonly #moduleCache = new Map<string, vm.Module>();
  readonly #cjsModuleCache = new Map<string, CommonJSModule>();
  // Make sure we always return the same objects from `require()` when the
  // `export_commonjs_default` compatibility flag is disabled
  readonly #namespaceCache = new WeakMap<any, any>();

  constructor(
    private readonly moduleRules: ProcessedModuleRule[],
    private readonly additionalModules: AdditionalModules,
    private readonly compat?: Compatibility
  ) {}

  get referencedPaths(): IterableIterator<string> {
    return this.#referencedPathSizes.keys();
  }

  get referencedPathsTotalSize(): number {
    // Make sure we only include each module once, even if it's referenced
    // from multiple scripts
    const sizes = Array.from(this.#referencedPathSizes.values());
    return sizes.reduce((total, size) => total + size, 0);
  }

  linker = (spec: string, referencing: vm.Module): vm.Module => {
    const relative = path.relative("", referencing.identifier);
    const errorBase = `Unable to resolve "${relative}" dependency "${spec}"`;

    if (referencing.identifier === STRING_SCRIPT_PATH) {
      throw new VMScriptRunnerError(
        "ERR_MODULE_STRING_SCRIPT",
        `${errorBase}: imports unsupported with string script`
      );
    }

    const additionalModule = this.additionalModules[spec];
    const identifier = additionalModule
      ? spec
      : // Get path to specified module relative to referencing module
        path.resolve(path.dirname(referencing.identifier), spec);

    // If we've already seen a module with the same identifier, return it, to
    // handle import cycles
    const cached = this.#moduleCache.get(identifier);
    if (cached) return cached;

    const moduleOptions = { identifier, context: referencing.context };
    let module: vm.Module;

    // If this is an additional module, construct and return it immediately
    if (additionalModule) {
      module = new vm.SyntheticModule(
        Object.keys(additionalModule),
        function () {
          for (const [key, value] of Object.entries(additionalModule)) {
            this.setExport(key, value);
          }
        },
        moduleOptions
      );
      this.#moduleCache.set(identifier, module);
      return module;
    }

    const rule = this.moduleRules.find((rule) => rule.include.test(identifier));
    if (rule === undefined) {
      const isBuiltin = builtinModules.includes(spec);
      const suggestion = isBuiltin ? SUGGEST_NODE : SUGGEST_BUNDLE;
      throw new VMScriptRunnerError(
        "ERR_MODULE_RULE",
        `${errorBase}: no matching module rules.\n${suggestion}`
      );
    }

    // Load module based on rule type
    const data = readFileSync(identifier);
    this.#referencedPathSizes.set(identifier, data.byteLength);
    switch (rule.type) {
      case "ESModule":
        module = new vm.SourceTextModule(data.toString("utf8"), {
          ...moduleOptions,
          importModuleDynamically: this.importModuleDynamically,
        });
        break;
      case "CommonJS":
        const mod = this.loadCommonJSModule(
          errorBase,
          identifier,
          spec,
          referencing.context
        );
        module = new vm.SyntheticModule<{ default: Context }>(
          ["default"],
          function () {
            this.setExport("default", mod.exports);
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
    this.#moduleCache.set(identifier, module);
    return module;
  };

  importModuleDynamically: SourceTextModuleImportModuleDynamically = async (
    spec,
    referencing
  ) => {
    const module = this.linker(spec, referencing);

    // Defend against concurrent execution by only calling `link()` and
    // `evaluate()` once, then storing the resulting `Promise` so future
    // executions can await it. Note, the `get()` calls below may return
    // `undefined` if `module` was already loaded statically.

    if (module.status === "unlinked") {
      linkingPromises.set(module, module.link(this.linker));
    }
    await linkingPromises.get(module);

    if (module.status === "linked") {
      evaluatingPromises.set(module, module.evaluate());
    }
    await evaluatingPromises.get(module);

    return module;
  };

  private loadCommonJSModule(
    errorBase: string,
    identifier: string,
    spec: string,
    context: vm.Context
  ): CommonJSModule {
    // If we've already seen a module with the same identifier, return it, to
    // handle import cycles
    const cached = this.#cjsModuleCache.get(identifier);
    if (cached) return cached;

    const additionalModule = this.additionalModules[spec];
    const module: CommonJSModule = { exports: {} };

    // If this is an additional module, return it immediately
    if (additionalModule) {
      module.exports = additionalModule.default;
      this.#cjsModuleCache.set(identifier, module);
      return module;
    }

    const rule = this.moduleRules.find((rule) => rule.include.test(identifier));
    if (rule === undefined) {
      const isBuiltin = builtinModules.includes(spec);
      const suggestion = isBuiltin ? SUGGEST_NODE : SUGGEST_BUNDLE;
      throw new VMScriptRunnerError(
        "ERR_MODULE_RULE",
        `${errorBase}: no matching module rules.\n${suggestion}`
      );
    }

    // Store in cache now as require is sync, so may load this module again
    // before this function returns
    this.#cjsModuleCache.set(identifier, module);

    // Load module based on rule type
    const data = readFileSync(identifier);
    this.#referencedPathSizes.set(identifier, data.byteLength);
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
    return module;
  }

  private createRequire(referencingIdentifier: string, context: vm.Context) {
    const relative = path.relative("", referencingIdentifier);
    const referencingDirname = path.dirname(referencingIdentifier);
    return (spec: string): Context => {
      const errorBase = `Unable to resolve "${relative}" dependency "${spec}"`;
      // Get path to specified module relative to referencing module
      const identifier = path.resolve(referencingDirname, spec);
      const mod = this.loadCommonJSModule(errorBase, identifier, spec, context);
      // https://developers.cloudflare.com/workers/platform/compatibility-dates/#commonjs-modules-do-not-export-a-module-namespace
      if (
        this.compat === undefined ||
        this.compat.isEnabled("export_commonjs_default")
      ) {
        return mod.exports;
      } else {
        // Make sure we always return the same object for an identifier
        let ns = this.#namespaceCache.get(mod);
        if (ns !== undefined) return ns;
        ns = Object.defineProperty({}, "default", {
          get: () => mod.exports,
          enumerable: true,
        });
        this.#namespaceCache.set(mod, ns);
        return ns;
      }
    };
  }
}
