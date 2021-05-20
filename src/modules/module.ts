import { Log } from "../log";
import { ProcessedOptions } from "../options";

export type Sandbox = Record<string, any>;

export abstract class Module {
  constructor(protected log: Log) {}

  abstract buildSandbox(options: ProcessedOptions): Sandbox;
}
