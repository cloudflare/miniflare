import { MiniflareError } from "@miniflare/shared";

export type VMScriptRunnerErrorCode =
  | "ERR_MODULE_DISABLED" // Missing --experimental-vm-modules flag
  | "ERR_MODULE_STRING_SCRIPT" // Attempt to resolve module within string script
  | "ERR_MODULE_RULE" // No matching module rule for file
  | "ERR_MODULE_UNSUPPORTED" // Unsupported module type
  | "ERR_CJS_MODULE_UNSUPPORTED"; // Unsupported module type for CommonJS (e.g. ES Modules)

export class VMScriptRunnerError extends MiniflareError<VMScriptRunnerErrorCode> {}
