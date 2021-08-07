import { Log } from "../log";
import { ProcessedOptions } from "../options";

export type Context = Record<string, any>;

export abstract class Module {
  constructor(protected log: Log) {}

  // The sandbox is everything that's always in global scope
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildSandbox(options: ProcessedOptions): Context {
    return {};
  }

  // The environment is everything that's included in env arguments when
  // using modules, and in the global scope otherwise
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildEnvironment(options: ProcessedOptions): Context {
    return {};
  }

  // Cleans up this module, disposing of any resources/connections
  dispose(): void | Promise<void> {}
}
