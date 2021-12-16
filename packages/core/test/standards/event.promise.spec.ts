import { setTimeout } from "timers/promises";
import {
  PromiseRejectionEvent,
  ServiceWorkerGlobalScope,
  WorkerGlobalScopeEventMap,
  kDispose,
} from "@miniflare/core";
import { LogLevel, TypedEventListener } from "@miniflare/shared";
import { TestLog, triggerPromise } from "@miniflare/shared-test";
import anyTest, { Macro, TestInterface } from "ava";

interface Context {
  log: TestLog;
  globalScope: ServiceWorkerGlobalScope;
}

const test = anyTest as TestInterface<Context>;

// Keep unhandledRejection and rejectionHandled tests in their own process, so
// we can remove AVA's unhandledRejection/rejectionHandled listeners
let unhandledRejectionListeners: NodeJS.UnhandledRejectionListener[];
let rejectionHandledListeners: NodeJS.RejectionHandledListener[];
test.before(() => {
  unhandledRejectionListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  rejectionHandledListeners = process.listeners("rejectionHandled");
  process.removeAllListeners("rejectionHandled");
});
test.after(() => {
  for (const listener of unhandledRejectionListeners) {
    process.addListener("unhandledRejection", listener);
  }
  for (const listener of rejectionHandledListeners) {
    process.addListener("rejectionHandled", listener);
  }
});

test.beforeEach((t) => {
  const log = new TestLog();
  const globalScope = new ServiceWorkerGlobalScope(log, {}, {});
  t.context = { log, globalScope };

  // Make sure we don't have any listeners that might interfere with tests
  t.is(process.listenerCount("unhandledRejection"), 0);
  t.is(process.listenerCount("rejectionHandled"), 0);
});

test.afterEach(() => {
  // Remove any remaining added listeners for the next test
  process.removeAllListeners("unhandledRejection");
  process.removeAllListeners("rejectionHandled");
});

// Run tests in serial as we're using process-wide event listeners

const processListenerOnceMacro: Macro<[event: string], Context> = async (
  t,
  event
) => {
  const lowerEvent = event.toLowerCase() as keyof WorkerGlobalScopeEventMap;

  const { log, globalScope } = t.context;
  const listener1: TypedEventListener<PromiseRejectionEvent> = () => {};
  const listener2: TypedEventListener<PromiseRejectionEvent> = () => {};

  // Try removing listener that hasn't been added yet
  t.is(process.listenerCount(event), 0);
  globalScope.removeEventListener(lowerEvent, listener1 as any);
  t.is(process.listenerCount(event), 0);
  t.deepEqual(log.logs, []);

  // Try adding first listener, check process wide listener added
  globalScope.addEventListener(lowerEvent, listener1 as any);
  t.is(process.listenerCount(event), 1);
  t.deepEqual(log.logs, [
    [LogLevel.VERBOSE, `Adding process ${event} listener...`],
  ]);
  log.logs = [];

  // Try adding another listener, check 2nd process wide listener not added
  globalScope.addEventListener(lowerEvent, listener2 as any);
  t.is(process.listenerCount(event), 1);
  t.deepEqual(log.logs, []);

  // Try remove one of the listeners, check no process wide listener removed
  globalScope.removeEventListener(lowerEvent, listener1 as any);
  t.is(process.listenerCount(event), 1);
  t.deepEqual(log.logs, []);

  // Try remove the other listener too, check process wide listener removed
  globalScope.removeEventListener(lowerEvent, listener2 as any);
  t.is(process.listenerCount(event), 0);
  t.deepEqual(log.logs, [
    [LogLevel.VERBOSE, `Removing process ${event} listener...`],
  ]);
};
processListenerOnceMacro.title = (providedTitle, event) =>
  `ServiceWorkerGlobalScope: (un)registers process wide ${event} event listener once`;
test.serial(processListenerOnceMacro, "unhandledRejection");
test.serial(processListenerOnceMacro, "rejectionHandled");

const processListenerDisposeMacro: Macro<[event: string], Context> = async (
  t,
  event
) => {
  const lowerEvent = event.toLowerCase() as keyof WorkerGlobalScopeEventMap;

  const { log, globalScope } = t.context;

  // Try disposing when listener that hasn't been added yet
  t.is(process.listenerCount(event), 0);
  globalScope[kDispose]();
  t.is(process.listenerCount(event), 0);
  t.deepEqual(log.logs, []);

  // Try adding listener, then disposing, check listener removed
  globalScope.addEventListener(lowerEvent, () => {});
  t.is(process.listenerCount(event), 1);
  t.deepEqual(log.logs, [
    [LogLevel.VERBOSE, `Adding process ${event} listener...`],
  ]);
  log.logs = [];

  globalScope[kDispose]();
  t.is(process.listenerCount(event), 0);
  t.deepEqual(log.logs, [
    [LogLevel.VERBOSE, `Removing process ${event} listener...`],
  ]);
};
processListenerDisposeMacro.title = (providedTitle, event) =>
  `ServiceWorkerGlobalScope: unregisters process wide ${event} event listener on dispose`;
test.serial(processListenerDisposeMacro, "unhandledRejection");
test.serial(processListenerDisposeMacro, "rejectionHandled");

test.serial(
  "ServiceWorkerGlobalScope: handles unhandledRejection if preventDefault() called",
  async (t) => {
    const { globalScope } = t.context;

    const [eventTrigger, eventPromise] =
      triggerPromise<PromiseRejectionEvent>();
    globalScope.addEventListener("unhandledrejection", (e) => {
      e.preventDefault();
      eventTrigger(e);
    });

    const error = new Error("Oops, did I do that?");
    // noinspection ES6MissingAwait
    const promise = Promise.reject(error);

    const event = await eventPromise;
    t.is(event.reason, error);
    t.is(event.promise, promise);
  }
);
test.serial(
  "ServiceWorkerGlobalScope: dispatches rejectionHandled events",
  async (t) => {
    const { globalScope } = t.context;

    globalScope.addEventListener("unhandledrejection", (e) => {
      e.preventDefault();
      e.promise.catch(() => "Caught!");
    });

    const [eventTrigger, eventPromise] =
      triggerPromise<PromiseRejectionEvent>();
    globalScope.addEventListener("rejectionhandled", (e) => {
      eventTrigger(e);
    });

    const error = new Error("Oops, did I do that?");
    // noinspection ES6MissingAwait
    const promise = Promise.reject(error);

    const event = await eventPromise;
    t.is(event.promise, promise);
  }
);

// Test logUnhandledRejections option
test.serial(
  "ServiceWorkerGlobalScope: logs unhandled rejections",
  async (t) => {
    const log = new TestLog();
    const [logTrigger, logPromise] = triggerPromise<Error>();
    log.error = logTrigger;
    new ServiceWorkerGlobalScope(log, {}, {}, false, true);

    const error = new Error("Oops, did I do that?");
    // noinspection ES6MissingAwait
    Promise.reject(error);

    const event = await logPromise;
    t.regex(
      event.stack!,
      /^Unhandled Promise Rejection: Error: Oops, did I do that\?/
    );
  }
);
test.serial(
  "ServiceWorkerGlobalScope: doesn't log unhandled rejections if preventDefault() called",
  async (t) => {
    const log = new TestLog();
    const globalScope = new ServiceWorkerGlobalScope(log, {}, {}, false, true);

    const [eventTrigger, eventPromise] =
      triggerPromise<PromiseRejectionEvent>();
    globalScope.addEventListener("unhandledrejection", (e) => {
      e.preventDefault();
      eventTrigger(e);
    });

    const error = new Error("Oops, did I do that?");
    // noinspection ES6MissingAwait
    const promise = Promise.reject(error);

    const event = await eventPromise;
    t.is(event.promise, promise);

    await setTimeout();
    t.is(log.logsAtLevel(LogLevel.ERROR).length, 0);
  }
);
