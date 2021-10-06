import { Log, LogLevel, MiniflareError } from "@miniflare/shared";

export class TestLogError extends MiniflareError<"ERR_ERROR"> {}

export type LogEntry = [level: LogLevel, message: string];

export class TestLog extends Log {
  logs: LogEntry[] = [];

  constructor() {
    super(LogLevel.VERBOSE);
  }

  log(message: string): void {
    this.logs.push([LogLevel.NONE, message]);
  }

  logWithLevel(level: LogLevel, message: string): void {
    if (level <= this.level) this.logs.push([level, message]);
  }

  error(message: string): void {
    throw new TestLogError("ERR_ERROR", message);
  }

  logsAtLevel(level: LogLevel): string[] {
    return this.logs
      .filter(([logLevel]) => logLevel === level)
      .map(([, message]) => message);
  }

  logsAtLevelOrBelow(level: LogLevel): LogEntry[] {
    return this.logs.filter(([logLevel]) => logLevel <= level);
  }
}

export class NoOpLog extends Log {
  log(): void {}
}
