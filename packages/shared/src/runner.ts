import { Compatibility } from "./compat";
import { Matcher } from "./data";
import { AdditionalModules, Context } from "./plugin";

export type ModuleRuleType =
  | "ESModule"
  | "CommonJS"
  | "Text"
  | "Data"
  | "CompiledWasm";

export interface ModuleRule {
  type: ModuleRuleType;
  include: string[];
  fallthrough?: boolean;
}

export interface ProcessedModuleRule {
  type: ModuleRuleType;
  include: Matcher;
}

// Blueprint filePath to use if script came from "script" option
export const STRING_SCRIPT_PATH = "<script>";

export interface ScriptBlueprint {
  readonly filePath: string;
  readonly code: string;
}

export interface ScriptRunnerResult {
  exports: Context;
  bundleSize?: number;
  watch?: string[];
}

export interface ScriptRunner {
  run(
    globalScope: Context,
    blueprint: ScriptBlueprint,
    modulesRules?: ProcessedModuleRule[],
    additionalModules?: AdditionalModules,
    compat?: Compatibility
  ): Promise<ScriptRunnerResult>;
}
