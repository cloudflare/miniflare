import { Matcher } from "./data";
import { Context, ModuleExports } from "./plugin";

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

// Blueprint fileName to use if script came from "script" option
export const STRING_SCRIPT_PATH = "<script>";

export interface ScriptBlueprint {
  readonly filePath: string;
  readonly code: string;
}

export interface ScriptRunnerResult {
  exports: ModuleExports;
  bundleSize?: number;
  watch?: string[];
}

export interface ScriptRunner {
  run(
    globalScope: Context,
    blueprints: ScriptBlueprint[],
    modulesRules?: ProcessedModuleRule[]
  ): Promise<ScriptRunnerResult>;
}
