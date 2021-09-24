import path from "path";
import { Colorize, dim, green, grey, red, reset, yellow } from "kleur/colors";

const cwd = process.cwd();
const cwdNodeModules = path.join(cwd, "node_modules");

export enum LogLevel {
  NONE,
  ERROR,
  WARN,
  INFO,
  DEBUG,
  VERBOSE,
}

const LEVEL_PREFIX: { [key in LogLevel]: string } = {
  [LogLevel.NONE]: "",
  [LogLevel.ERROR]: "err",
  [LogLevel.WARN]: "wrn",
  [LogLevel.INFO]: "inf",
  [LogLevel.DEBUG]: "dbg",
  [LogLevel.VERBOSE]: "vrb",
};

const LEVEL_COLOUR: { [key in LogLevel]: Colorize } = {
  [LogLevel.NONE]: reset,
  [LogLevel.ERROR]: red,
  [LogLevel.WARN]: yellow,
  [LogLevel.INFO]: green,
  [LogLevel.DEBUG]: grey,
  [LogLevel.VERBOSE]: (input) => dim(grey(input as any)) as any,
};

function dimInternalStackLine(line: string): string {
  if (
    line.startsWith("    at") &&
    (!line.includes(cwd) || line.includes(cwdNodeModules))
  ) {
    return dim(line);
  }
  return line;
}

export class Log {
  constructor(private readonly level = LogLevel.INFO) {}

  log(message: string): void {
    console.log(message);
  }

  logWithLevel(level: LogLevel, message: string): void {
    if (level <= this.level) {
      this.log(LEVEL_COLOUR[level](`[mf:${LEVEL_PREFIX[level]}] ${message}`));
    }
  }

  error(message: string | { stack?: string }): void {
    if (typeof message === "string") {
      this.logWithLevel(LogLevel.ERROR, message);
    } else if (message.stack) {
      const lines = message.stack.split("\n").map(dimInternalStackLine);
      this.logWithLevel(LogLevel.ERROR, lines.join("\n"));
    } else {
      this.logWithLevel(LogLevel.ERROR, message.toString());
    }
  }

  warn(message: string): void {
    this.logWithLevel(LogLevel.WARN, message);
  }

  // TODO: implement
  // warnOnce(message: string): void {}

  info(message: string): void {
    this.logWithLevel(LogLevel.INFO, message);
  }

  debug(message: string): void {
    this.logWithLevel(LogLevel.DEBUG, message);
  }

  verbose(message: string): void {
    this.logWithLevel(LogLevel.VERBOSE, message);
  }
}
