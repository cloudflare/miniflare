import {
  ReadableStreamDefaultReader,
  TransformStream,
  WritableStreamDefaultWriter,
} from "stream/web";
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

export class AsyncTestLog extends Log {
  #reader: ReadableStreamDefaultReader<LogEntry>;
  #writer: WritableStreamDefaultWriter<LogEntry>;

  constructor() {
    super(LogLevel.VERBOSE);
    const { readable, writable } = new TransformStream<LogEntry, LogEntry>();
    this.#reader = readable.getReader();
    this.#writer = writable.getWriter();
  }

  log(message: string): void {
    this.logWithLevel(LogLevel.NONE, message);
  }

  logWithLevel(level: LogLevel, message: string): void {
    void this.#writer.write([level, message]);
  }

  async next(): Promise<LogEntry | undefined> {
    return (await this.#reader.read()).value;
  }

  async nextAtLevel(level: LogLevel): Promise<string | undefined> {
    while (true) {
      const entry = await this.next();
      if (!entry) return;
      if (entry[0] === level) return entry[1];
    }
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
