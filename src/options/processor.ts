import childProcess from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { URL } from "url";
import { promisify } from "util";
import dotenv from "dotenv";
import cron from "node-cron";
import picomatch from "picomatch";
import selfSigned from "selfsigned";
import { MiniflareError } from "../helpers";
import { Mutex, defaultClock } from "../kv/helpers";
import { Log } from "../log";
import { ScriptBlueprint } from "../scripts";
import { getWranglerOptions } from "./wrangler";
import {
  ModuleRuleType,
  Options,
  ProcessedDurableObject,
  ProcessedHTTPSOptions,
  ProcessedModuleRule,
  ProcessedOptions,
  defaultModuleRules,
  getAccessibleHosts,
  stringScriptPath,
} from "./index";

const noop = () => {};
const matchOptions: picomatch.PicomatchOptions = { contains: true };

const certGenerate = promisify(selfSigned.generate);
const certDefaultRoot = path.resolve(".mf", "cert");
const certAttrs: selfSigned.Attributes = [
  { name: "commonName", value: "localhost" },
];
const certDays = 30;
const certOptions: selfSigned.Options = {
  algorithm: "sha256",
  days: certDays,
  keySize: 2048,
  extensions: [
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true,
      codeSigning: true,
      timeStamping: true,
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        ...getAccessibleHosts().map((ip) => ({ type: 7, ip })),
      ],
    },
  ],
};

export class OptionsProcessor {
  _scriptBlueprints: Record<string, ScriptBlueprint> = {};
  private _buildMutex = new Mutex();
  readonly wranglerConfigPath: string;
  readonly packagePath: string;

  constructor(
    private log: Log,
    private initialOptions: Options,
    private defaultCertRoot = certDefaultRoot,
    private clock = defaultClock
  ) {
    if (initialOptions.script) initialOptions.scriptPath = stringScriptPath;
    this.wranglerConfigPath = path.resolve(
      initialOptions.wranglerConfigPath ?? "wrangler.toml"
    );
    this.packagePath = path.resolve(
      initialOptions.packagePath ?? "package.json"
    );
  }

  private _globsToRegexps(globs?: string[]): RegExp[] {
    const regexps: RegExp[] = [];
    for (const glob of globs ?? []) {
      const regexp = picomatch.makeRe(glob, matchOptions);
      // Override toString so we log the glob not the regexp
      regexp.toString = () => glob;
      regexps.push(regexp);
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

  async getPackageScript(modules?: boolean): Promise<string | undefined> {
    const packagePathSet = this.initialOptions.packagePath !== undefined;
    const input = await this._readFile(this.packagePath, packagePathSet);
    if (input === "") return;
    try {
      const pkg = JSON.parse(input);
      const main = modules ? pkg.module : pkg.main;
      // Resolve script path relative to package.json
      if (main) return path.resolve(path.dirname(this.packagePath), main);
    } catch (e) {
      this.log.error(
        `Unable to parse ${path.relative(
          "",
          this.packagePath
        )}: ${e} (ignoring)`
      );
    }
  }

  async getScriptPath(options: Options): Promise<string> {
    // Always get the package script so we log an error if the user was
    // expecting it to be loaded
    const pkgScript = await this.getPackageScript(options.modules);
    // Make sure we've got a main script
    if (options.scriptPath === undefined) {
      if (pkgScript === undefined) {
        throw new MiniflareError(
          `No script defined, either include it explicitly, set build.upload.main in Wrangler configuration, or set ${
            options.modules ? "module" : "main"
          } in package.json`
        );
      }
      // Script is already resolved in getPackageScript
      return pkgScript;
    } else {
      // Resolve and load script relative to current directory
      return options.scriptPath !== stringScriptPath
        ? path.resolve(options.scriptPath)
        : options.scriptPath;
    }
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

  async getHttpsOptions({
    https,
  }: Options): Promise<ProcessedHTTPSOptions | undefined> {
    // If options are falsy, don't use HTTPS
    if (!https) return;
    // If options are true, use a self-signed certificate at default location
    if (https === true) https = this.defaultCertRoot;
    // If options are now a string, use a self-signed certificate
    if (typeof https === "string") {
      const keyPath = path.join(https, "key.pem");
      const certPath = path.join(https, "cert.pem");

      // Determine whether to regenerate self-signed certificate, should do this
      // if doesn't exist or about to expire
      let regenerate = true;
      try {
        const keyStat = await fs.stat(keyPath);
        const certStat = await fs.stat(certPath);
        const created = Math.max(keyStat.ctimeMs, certStat.ctimeMs);
        regenerate = this.clock() - created > (certDays - 2) * 86400000;
      } catch {}

      // Generate self signed certificate if needed
      if (regenerate) {
        this.log.info("Generating new self-signed certificate...");
        const cert = await certGenerate(certAttrs, certOptions);
        // Write cert so we can reuse it later
        await fs.mkdir(https, { recursive: true });
        await fs.writeFile(keyPath, cert.private, "utf8");
        await fs.writeFile(certPath, cert.cert, "utf8");
      }

      https = { keyPath, certPath };
    }

    // Alias so each option fits onto one line
    const h = https;
    return {
      key: h.key ?? (h.keyPath && (await this._readFile(h.keyPath))),
      cert: h.cert ?? (h.certPath && (await this._readFile(h.certPath))),
      ca: h.ca ?? (h.caPath && (await this._readFile(h.caPath))),
      pfx: h.pfx ?? (h.pfxPath && (await this._readFile(h.pfxPath))),
      passphrase: h.passphrase,
    };
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
    this._scriptBlueprints = {};
    options.scripts = this._scriptBlueprints;
    // Force modules mode if we're using Durable Objects: we need to be able to
    // access named script exports (do this before getting main script so
    // we know whether to fallback to main or module in package.json)
    if (Object.keys(options.durableObjects ?? {}).length > 0) {
      options.modules = true;
    }
    options.scriptPath = await this.getScriptPath(options);
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

    options.processedHttps = await this.getHttpsOptions(options);

    return options;
  }
}
