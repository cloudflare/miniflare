import { Log, LogLevel } from "@miniflare/shared";
import { ExecutionContext } from "ava";

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

  error(message: Error): void {
    throw message;
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

// .serial required for intercepting console.log
export function interceptConsoleLogs(t: ExecutionContext): string[] {
  const logs: string[] = [];
  const originalLog = console.log;
  t.teardown(() => (console.log = originalLog));
  console.log = (...args: string[]) => logs.push(args.join(" "));
  return logs;
}
