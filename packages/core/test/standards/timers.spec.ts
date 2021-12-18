import { setTimeout } from "timers/promises";
import {
  DOMException,
  Scheduler,
  inputGatedSetInterval,
  inputGatedSetTimeout,
} from "@miniflare/core";
import {
  TestInputGate,
  triggerPromise,
  waitsForInputGate,
} from "@miniflare/shared-test";
import test from "ava";

test("inputGatedSetTimeout: calls callback with no input gate in context", async (t) => {
  const [trigger, promise] = triggerPromise<[number, string]>();
  inputGatedSetTimeout((a, b) => trigger([a, b]), 10, 42, "test");
  t.deepEqual(await promise, [42, "test"]);
});
test("inputGatedSetTimeout: can cancel timeout", async (t) => {
  const handle = inputGatedSetTimeout(() => t.fail(), 10);
  clearTimeout(handle);
  await setTimeout(100);
  t.pass();
});
test("inputGatedSetTimeout: waits for input gate to open before calling callback", async (t) => {
  const result = await waitsForInputGate(t, () => {
    const [trigger, promise] = triggerPromise<[number, string]>();
    inputGatedSetTimeout((a, b) => trigger([a, b]), 10, 42, "test");
    return promise;
  });
  t.deepEqual(result, [42, "test"]);
});

test("inputGatedSetInterval: calls callback with no input gate in context", async (t) => {
  let [trigger, promise] = triggerPromise<[number, string]>();
  const handle = inputGatedSetInterval(
    (a, b) => trigger([a, b]),
    10,
    42,
    "test"
  );
  t.deepEqual(await promise, [42, "test"]);
  [trigger, promise] = triggerPromise<[number, string]>();
  t.deepEqual(await promise, [42, "test"]);
  clearInterval(handle);
});
test("inputGatedSetInterval: can cancel interval", async (t) => {
  const handle = inputGatedSetInterval(() => t.fail(), 10);
  clearInterval(handle);
  await setTimeout(100);
  t.pass();
});
test("inputGatedSetInterval: waits for input gate to open before calling callback", async (t) => {
  const inputGate = new TestInputGate();
  const events: number[] = [];

  // Check with first callback
  let [trigger, promise] = triggerPromise<[number, string]>();
  let [openTrigger, openPromise] = triggerPromise<void>();
  const handlePromise = inputGate.runWith(async () => {
    // Close input gate
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    const handle = inputGatedSetInterval(
      (a, b) => trigger([a, b]),
      10,
      42,
      "test"
    );
    await promise;
    events.push(1);
    return handle;
  });
  await inputGate.waitedPromise;
  inputGate.resetWaitedPromise();
  events.push(2);
  openTrigger();
  const handle = await handlePromise;
  t.deepEqual(events, [2, 1]);

  // Check with second callback
  [trigger, promise] = triggerPromise<[number, string]>();
  [openTrigger, openPromise] = triggerPromise<void>();
  const callbackPromise = inputGate.runWith(async () => {
    // Close input gate again
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    await promise;
    events.push(3);
  });
  await inputGate.waitedPromise;
  events.push(4);
  openTrigger();
  await callbackPromise;
  t.deepEqual(events, [2, 1, 4, 3]);

  clearInterval(handle);
});

test("AbortSignal.timeout: triggers signal after timeout", async (t) => {
  // @ts-expect-error `timeout` isn't included in Node.js yet
  const signal = AbortSignal.timeout(50);
  let aborted;
  signal.addEventListener("abort", () => (aborted = true));
  t.false(signal.aborted);
  await setTimeout(100);
  t.true(signal.aborted);
  t.true(aborted);
});
test("AbortSignal.timeout: requires numeric timeout", (t) => {
  // @ts-expect-error `timeout` isn't included in Node.js yet
  t.throws(() => AbortSignal.timeout(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'timeout' on 'AbortSignal': parameter 1 is not of type 'integer'.",
  });
  // @ts-expect-error this is valid in the real Workers runtime
  AbortSignal.timeout(undefined);
  // @ts-expect-error this is valid in the real Workers runtime
  // noinspection TypeScriptValidateJSTypes
  AbortSignal.timeout("1");
});
test("AbortSignal.timeout: included on constructor obtained via AbortController#signal prototype", (t) => {
  const controller = new AbortController();
  const constructor = Object.getPrototypeOf(controller.signal).constructor;
  // @ts-expect-error `timeout` was added in Node 17.3.0
  t.is(constructor.timeout, AbortSignal.timeout);
});

const scheduler = new Scheduler();
test("scheduler.wait: resolves after timeout", async (t) => {
  let resolved = false;
  scheduler.wait(100).then(() => (resolved = true));
  t.false(resolved);
  await setTimeout(10);
  t.false(resolved);
  await setTimeout(200);
  t.true(resolved);
});
test("scheduler.wait: rejects on abort", async (t) => {
  const controller = new AbortController();
  const promise = scheduler.wait(1000, { signal: controller.signal });
  await setTimeout(10);
  controller.abort();
  await t.throwsAsync(promise, {
    instanceOf: DOMException,
    name: "AbortError",
    message: "The operation was aborted",
  });
});
test("scheduler.wait: does nothing if aborted after resolve", async (t) => {
  const controller = new AbortController();
  await scheduler.wait(10, { signal: controller.signal });
  controller.abort();
  t.pass();
});
test("scheduler.wait: requires numeric timeout", async (t) => {
  t.throws(() => scheduler.wait(), {
    instanceOf: TypeError,
    message:
      "Failed to execute 'wait' on 'Scheduler': parameter 1 is not of type 'integer'.",
  });
  await scheduler.wait(undefined);
  // @ts-expect-error this is valid in the real Workers runtime
  // noinspection TypeScriptValidateJSTypes
  await scheduler.wait("1");
});
