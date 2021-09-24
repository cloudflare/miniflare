import { Log, LogLevel, MiniflareError } from "@miniflare/shared";

export class TestLogError extends MiniflareError<"ERR_ERROR"> {}

export class TestLog extends Log {
  readonly logs: [level: LogLevel, message: string][] = [];

  constructor() {
    super(LogLevel.VERBOSE);
  }

  log(message: string): void {
    this.logs.push([LogLevel.NONE, message]);
  }

  logWithLevel(level: LogLevel, message: string): void {
    this.logs.push([level, message]);
  }

  error(message: string): void {
    throw new TestLogError("ERR_ERROR", message);
  }
}

export class NoOpLog extends Log {
  log(): void {}
}
