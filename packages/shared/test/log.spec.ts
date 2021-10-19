import { Log, LogLevel } from "@miniflare/shared";
import test, { ExecutionContext } from "ava";

// .serial required for intercepting console.log
function interceptConsoleLogs(t: ExecutionContext): string[] {
  const logs: string[] = [];
  const originalLog = console.log;
  t.teardown(() => (console.log = originalLog));
  console.log = (...args: string[]) => logs.push(args.join(" "));
  return logs;
}

test.serial("Log: logs at all levels", (t) => {
  const logs = interceptConsoleLogs(t);
  const log = new Log(LogLevel.VERBOSE);

  log.error(new Error("Test error"));
  log.warn("Warning");
  log.info("Info");
  log.debug("Debug");
  log.verbose("Verbose");

  t.is(logs.length, 5);
  t.regex(logs[0], /^\[mf:err] Error: Test error/);
  t.deepEqual(logs.slice(1), [
    "[mf:wrn] Warning",
    "[mf:inf] Info",
    "[mf:dbg] Debug",
    "[mf:vrb] Verbose",
  ]);
});
test.serial("Log: throws errors if level less than ERROR", (t) => {
  const log = new Log(LogLevel.NONE);
  t.throws(() => log.error(new Error("Test error")), {
    instanceOf: Error,
    message: "Test error",
  });
});
test.serial("Log: only logs messages less than or equal level", (t) => {
  const logs = interceptConsoleLogs(t);
  const log = new Log(LogLevel.WARN);
  log.error(new Error("Test error"));
  log.warn("Warning");
  log.info("Info");
  log.debug("Debug");
  log.verbose("Verbose");
  t.is(logs.length, 2);
  t.regex(logs[0], /^\[mf:err] Error: Test error/);
  t.is(logs[1], "[mf:wrn] Warning");
});
