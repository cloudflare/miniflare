import childProcess from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { URL } from "url";
import dotenv from "dotenv";
import micromatch from "micromatch";
import cron from "node-cron";
import { MiniflareError } from "../error";
import { Mutex } from "../kv/helpers";
import { Log } from "../log";
import { ScriptBlueprint } from "../scripts";
import { getWranglerOptions } from "./wrangler";
import {
  ModuleRuleType,
  Options,
  ProcessedDurableObject,
  ProcessedModuleRule,
  ProcessedOptions,
  defaultModuleRules,
  stringScriptPath,
} from "./index";

const noop = () => {};
const micromatchOptions: micromatch.Options = { contains: true };

export class OptionsProcessor {
  _scriptBlueprints: Record<string, ScriptBlueprint> = {};
  private _buildMutex = new Mutex();
  readonly wranglerConfigPath: string;

  constructor(private log: Log, private initialOptions: Options) {
    if (initialOptions.script) initialOptions.scriptPath = stringScriptPath;
    this.wranglerConfigPath = path.resolve(
      initialOptions.wranglerConfigPath ?? "wrangler.toml"
    );
  }

  private _globsToRegexps(globs?: string[]): RegExp[] {
    const regexps: RegExp[] = [];
    for (const glob of globs ?? []) {
      const regexp = micromatch.makeRe(glob, micromatchOptions) as
        | RegExp
        | false;
      if (regexp === false) {
        this.log.error(`Unable to parse glob "${glob}" (ignoring)`);
      } else {
        // Override toString so we log the glob not the regexp
        regexp.toString = () => glob;
        regexps.push(regexp);
      }
    }
    return regexps;
  }

  private async _readFile(filePath: string, logError = true): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (e) {
      if (logError) {
        this.log.error(
          `Unable to read ${path.relative(
            "",
            filePath
          )}: ${e} (defaulting to empty string)`
        );
      }
      return "";
    }
  }

  async addScriptBlueprint(scriptPath: string): Promise<void> {
    if (scriptPath in this._scriptBlueprints) return;
    // Read file contents and create script object
    const code =
      scriptPath === stringScriptPath && this.initialOptions.script
        ? this.initialOptions.script
        : await this._readFile(scriptPath);
    this._scriptBlueprints[scriptPath] = new ScriptBlueprint(code, scriptPath);
  }

  resetScriptBlueprints(): void {
    this._scriptBlueprints = {};
  }

  runCustomBuild(command: string, basePath?: string): Promise<void> {
    return this._buildMutex.run(
      () =>
        new Promise((resolve) => {
          const build = childProcess.spawn(command, {
            cwd: basePath,
            shell: true,
            stdio: "inherit",
          });
          build.on("exit", (code) => {
            if (code === 0) {
              this.log.info("Build succeeded");
            } else {
              this.log.error(`Build failed with exit code ${code}`);
            }
            resolve();
          });
        })
    );
  }

  async getWranglerOptions(): Promise<Options> {
    let wranglerOptions: Options = {};
    const wranglerConfigPathSet =
      this.initialOptions.wranglerConfigPath !== undefined;
    const input = await this._readFile(
      this.wranglerConfigPath,
      wranglerConfigPathSet
    );
    const inputDir = path.dirname(this.wranglerConfigPath);
    try {
      wranglerOptions = getWranglerOptions(
        input,
        inputDir,
        this.initialOptions.wranglerConfigEnv
      );
    } catch (e) {
      this.log.error(
        `Unable to parse ${path.relative(
          "",
          this.wranglerConfigPath
        )}: ${e} (line: ${e.line}, col: ${e.column}) (ignoring)`
      );
    }
    return wranglerOptions;
  }

  getScriptPath(options: Options): string {
    // Make sure we've got a main script
    if (options.scriptPath === undefined) {
      throw new MiniflareError(
        "No script defined, either include it explicitly, or set build.upload.main in Wrangler configuration"
      );
    }
    // Resolve and load script
    return options.scriptPath !== stringScriptPath
      ? path.resolve(options.scriptPath)
      : options.scriptPath;
  }

  getProcessedDurableObjects(options: Options): ProcessedDurableObject[] {
    // Make sure all durable objects are defined as objects and have a
    // scriptPath set
    return Object.entries(options.durableObjects ?? {}).map(
      ([name, details]) => {
        const className =
          typeof details === "object" ? details.className : details;
        const scriptPath =
          typeof details === "object" ? details.scriptPath : undefined;
        const resolvedScriptPath = scriptPath
          ? path.resolve(scriptPath)
          : (options.scriptPath as string);
        return {
          name,
          className,
          scriptPath: resolvedScriptPath,
        };
      }
    );
  }

  getProcessedModulesRules(options: Options): ProcessedModuleRule[] {
    const processedModulesRules: ProcessedModuleRule[] = [];
    const finalisedTypes = new Set<ModuleRuleType>();
    for (const rule of [
      ...(options.modulesRules ?? []),
      ...defaultModuleRules,
    ]) {
      if (finalisedTypes.has(rule.type)) {
        // Ignore rule if type didn't enable fallthrough
        continue;
      }
      processedModulesRules.push({
        type: rule.type,
        include: this._globsToRegexps(rule.include),
      });
      if (!rule.fallthrough) finalisedTypes.add(rule.type);
    }
    return processedModulesRules;
  }

  async getEnvBindings(
    options: Options
  ): Promise<{ envPath: string; envBindings: Record<string, string> }> {
    // Normalise the envPath (defaulting to .env) so we can compare it when
    // watching
    const envPathSet = options.envPath !== undefined;
    const envPath = path.resolve(options.envPath ?? ".env");
    // Get variable bindings from envPath (only log not found if option was set)
    const envBindings = dotenv.parse(await this._readFile(envPath, envPathSet));
    return { envPath, envBindings };
  }

  async getWasmBindings(
    options: Options
  ): Promise<Record<string, WebAssembly.Module>> {
    const wasmBindings: Record<string, WebAssembly.Module> = {};
    for (const [name, wasmPath] of Object.entries(options.wasmBindings ?? {})) {
      try {
        wasmBindings[name] = new WebAssembly.Module(
          await fs.readFile(wasmPath)
        );
      } catch (e) {
        this.log.error(`Unable to load WASM module "${name}": ${e} (ignoring)`);
      }
    }
    return wasmBindings;
  }

  getUpstreamUrl(options: Options): URL | undefined {
    try {
      return options.upstream ? new URL(options.upstream) : undefined;
    } catch (e) {
      this.log.error(
        `Unable to parse upstream: ${e} (defaulting to no upstream)`
      );
    }
    return undefined;
  }

  getValidatedCrons(options: Options): string[] {
    const validatedCrons: string[] = [];
    for (const spec of options.crons ?? []) {
      try {
        // We don't use cron.validate here since that doesn't tell us why
        // parsing failed
        const task = cron.schedule(spec, noop, { scheduled: false });
        task.destroy();
        // validateCrons is always defined here
        validatedCrons.push(spec);
      } catch (e) {
        this.log.error(`Unable to parse cron "${spec}": ${e} (ignoring)`);
      }
    }
    return validatedCrons;
  }

  async getProcessedOptions(initial?: boolean): Promise<ProcessedOptions> {
    // Get wrangler options first (if set) since initialOptions override these
    const wranglerOptions = await this.getWranglerOptions();

    // Override wrangler options with initialOptions, since these should have
    // higher priority
    const options: ProcessedOptions = {
      ...wranglerOptions,
      ...this.initialOptions,
    };

    // Run custom build command if this is the first time we're getting options
    // to make sure the scripts exist
    if (initial && options.buildCommand) {
      await this.runCustomBuild(options.buildCommand, options.buildBasePath);
    }

    // Resolve and load all scripts (including Durable Objects')
    options.scripts = this._scriptBlueprints;
    options.scriptPath = this.getScriptPath(options);
    await this.addScriptBlueprint(options.scriptPath);
    options.processedDurableObjects = this.getProcessedDurableObjects(options);
    for (const durableObject of options.processedDurableObjects) {
      await this.addScriptBlueprint(durableObject.scriptPath);
    }

    options.processedModulesRules = this.getProcessedModulesRules(options);

    const { envPath, envBindings } = await this.getEnvBindings(options);
    options.envPath = envPath;

    const wasmBindings = await this.getWasmBindings(options);

    // Rebuild bindings object taking into account priorities: envBindings and
    // wasmBindings should override wrangler, and initialOptions should override
    // everything
    options.bindings = {
      ...wranglerOptions.bindings,
      ...envBindings,
      ...wasmBindings,
      ...this.initialOptions.bindings,
    };

    options.upstreamUrl = this.getUpstreamUrl(options);
    options.validatedCrons = this.getValidatedCrons(options);
    options.siteIncludeRegexps = this._globsToRegexps(options.siteInclude);
    options.siteExcludeRegexps = this._globsToRegexps(options.siteExclude);

    return options;
  }
}
