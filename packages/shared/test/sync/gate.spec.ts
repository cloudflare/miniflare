// noinspection ES6MissingAwait

import { setTimeout } from "timers/promises";
import {
  InputGate,
  InputGatedEventTarget,
  OutputGate,
  runWithInputGateClosed,
  waitForOpenInputGate,
  waitForOpenOutputGate,
  waitUntilOnOutputGate,
} from "@miniflare/shared";
import { noop, triggerPromise } from "@miniflare/shared-test";
import test from "ava";

test("waitForOpenInputGate: waits for input gate in context to open", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();
  await inputGate.runWith(async () => {
    void inputGate.runWithClosed(async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    });
    events.push(3);
    await waitForOpenInputGate();
    events.push(4);
  });
  t.deepEqual(events, [3, 1, 2, 4]);
});
test("waitForOpenInputGate: returns immediately if no input gate in context", (t) => {
  t.is(waitForOpenInputGate(), undefined);
});

test("runWithInputGateClosed: closes input gate in context and runs closure", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();
  await inputGate.runWith(async () => {
    void runWithInputGateClosed(async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    });
    events.push(3);
    await inputGate.waitForOpen();
    events.push(4);
  });
  t.deepEqual(events, [3, 1, 2, 4]);
});
test("runWithInputGateClosed: runs closure without closing input gate in context if concurrency allowed", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();
  const [waitTrigger, waitPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  await inputGate.runWith(async () => {
    void runWithInputGateClosed(async () => {
      events.push(1);
      await waitPromise; // This would deadlock if concurrency wasn't allowed
      events.push(2);
      finishTrigger();
    }, true);
    events.push(3);
    await inputGate.waitForOpen();
    waitTrigger();
    events.push(4);
  });
  await finishPromise;
  t.deepEqual(events, [1, 3, 4, 2]);
});
test("runWithInputGateClosed: runs closure if no input gate in context", async (t) => {
  // Test will fail if no assertions run
  await runWithInputGateClosed(async () => t.pass());
});

test("waitForOpenOutputGate: waits for output gate in context to open", async (t) => {
  const events: number[] = [];
  const outputGate = new OutputGate();
  await outputGate.runWith(async () => {
    outputGate.waitUntil(
      (async () => {
        events.push(1);
        await setTimeout();
        events.push(2);
      })()
    );
    events.push(3);
    await waitForOpenOutputGate();
    events.push(4);
  });
  t.deepEqual(events, [1, 3, 2, 4]);
});
test("waitForOpenOutputGate: returns immediately if no output gate in context", (t) => {
  t.is(waitForOpenOutputGate(), undefined);
});

test("waitUntilOnOutputGate: closes output gate in context until promise resolves", async (t) => {
  const events: number[] = [];
  const outputGate = new OutputGate();
  await outputGate.runWith(async () => {
    const promise = (async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    })();
    t.is(waitUntilOnOutputGate(promise), promise);
    events.push(3);
    await outputGate.waitForOpen();
    events.push(4);
  });
  t.deepEqual(events, [1, 3, 2, 4]);
});
test("waitUntilOnOutputGate: returns promise without closing output gate in context if unconfirmed allowed", async (t) => {
  const events: number[] = [];
  const outputGate = new OutputGate();
  const [waitTrigger, waitPromise] = triggerPromise<void>();
  const [finishTrigger, finishPromise] = triggerPromise<void>();
  await outputGate.runWith(async () => {
    const promise = (async () => {
      events.push(1);
      await waitPromise; // This would deadlock if unconfirmed wasn't allowed
      events.push(2);
      finishTrigger();
    })();
    t.is(waitUntilOnOutputGate(promise, true), promise);
    events.push(3);
    await outputGate.waitForOpen();
    waitTrigger();
    events.push(4);
  });
  await finishPromise;
  t.deepEqual(events, [1, 3, 4, 2]);
});
test("waitUntilOnOutputGate: returns promise if no output gate in context", async (t) => {
  const promise = Promise.resolve();
  t.is(waitUntilOnOutputGate(promise), promise);
});

test("InputGate: runWith: runs closure with input gate in context", async (t) => {
  const inputGate = new InputGate();
  await inputGate.runWith(() => t.not(waitForOpenInputGate(), undefined));
});
test("InputGate: runWith: waits for gate to open before running closure", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();

  // Close input gate
  const [openTrigger, openPromise] = triggerPromise<void>();
  void inputGate.runWithClosed(() => openPromise);
  await setTimeout();

  // This is the same situation as a fetch to a Durable Object that called
  // blockConcurrencyWhile in its constructor
  const runWithPromise = inputGate.runWith(() => events.push(1));
  await setTimeout();
  events.push(2);
  openTrigger();
  await runWithPromise;
  t.deepEqual(events, [2, 1]);
});

test("InputGate: waitForOpen: returns if gate already open", async (t) => {
  const inputGate = new InputGate();
  await inputGate.waitForOpen();
  t.pass();
});
test("InputGate: waitForOpen/runWithClosed: waits for gate to open", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();

  // Close input gate
  const [openTrigger1, openPromise1] = triggerPromise<void>();
  const [openTrigger2, openPromise2] = triggerPromise<void>();
  void inputGate.runWithClosed(() => {
    events.push(1);
    return openPromise1;
  });
  events.push(2); // Should be before 1
  void inputGate.runWithClosed(() => openPromise2);
  await setTimeout();

  const waitForOpenPromise = inputGate.waitForOpen().then(() => events.push(3));
  await setTimeout();
  events.push(4);
  openTrigger1();
  // Check requires all promises to resolve before opening
  await setTimeout();
  t.deepEqual(events, [2, 1, 4]);
  openTrigger2();
  await waitForOpenPromise;
  t.deepEqual(events, [2, 1, 4, 3]);
});
test("InputGate: waitForOpen: waits for gate to open if called concurrently", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();

  // This is the same situation as 2 concurrent fetches to a Durable Object
  // for unique numbers
  function asyncOperation(): Promise<void> {
    return inputGate.runWithClosed(async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    });
  }
  await Promise.all([
    inputGate.waitForOpen().then(asyncOperation),
    inputGate.waitForOpen().then(asyncOperation),
  ]);
  t.deepEqual(events, [1, 2, 1, 2]); // Not [1, 1, 2, 2]
});

test("InputGate: runWithClosed: allows concurrent execution", async (t) => {
  const inputGate = new InputGate();
  const [trigger1, promise1] = triggerPromise<void>();
  const [trigger2, promise2] = triggerPromise<void>();
  await Promise.all([
    inputGate.runWithClosed(async () => {
      trigger1();
      await promise2; // Deadlock if below wasn't executed concurrently
    }),
    inputGate.runWithClosed(async () => {
      trigger2();
      await promise1;
    }),
  ]);
  t.pass();
});
test("InputGate: runWithClosed: closing child input gate closes parent too", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();

  // Close (child) input gate
  const [openTrigger, openPromise] = triggerPromise<void>();
  inputGate.runWithClosed(async () => {
    void runWithInputGateClosed(() => openPromise);
  });
  await setTimeout();

  const waitForOpenPromise = inputGate.waitForOpen().then(() => events.push(1));
  await setTimeout();
  events.push(2);
  openTrigger();
  await waitForOpenPromise;
  t.deepEqual(events, [2, 1]);
});
test("InputGate: runWithClosed: event delivered to child even though parent input gate closed", async (t) => {
  const inputGate = new InputGate();
  // This is the same situation as a blockConcurrencyWhile that makes an async
  // I/O request
  await inputGate.runWithClosed(async () => {
    await setTimeout();
    await waitForOpenInputGate();
  });
  t.pass();
});

test("OutputGate: runWith: runs closure with output gate in context", async (t) => {
  const outputGate = new OutputGate();
  await outputGate.runWith(() => t.not(waitForOpenOutputGate(), undefined));
});
test("OutputGate: runWith: waits for gate to open before returning result", async (t) => {
  const events: number[] = [];
  const outputGate = new OutputGate();

  // Close output gate
  const [openTrigger, openPromise] = triggerPromise<void>();
  outputGate.waitUntil(openPromise);

  const runWithPromise = outputGate.runWith(noop).then(() => events.push(1));
  await setTimeout();
  events.push(2);
  openTrigger();
  await runWithPromise;
  t.deepEqual(events, [2, 1]);
});

test("OutputGate: waitForOpen/waitUntil: waits for gate to open", async (t) => {
  const events: number[] = [];
  const outputGate = new OutputGate();

  // Close output gate
  const [openTrigger1, openPromise1] = triggerPromise<void>();
  const [openTrigger2, openPromise2] = triggerPromise<void>();
  outputGate.waitUntil(openPromise1);
  outputGate.waitUntil(openPromise2);

  const runWithPromise = outputGate.waitForOpen().then(() => events.push(1));
  await setTimeout();
  events.push(2);
  openTrigger1();
  // Check requires all promises to resolve before opening
  await setTimeout();
  t.deepEqual(events, [2]);
  openTrigger2();
  await runWithPromise;
  t.deepEqual(events, [2, 1]);
});

test("InputGatedEventTarget: dispatches events with no input gate in context", async (t) => {
  const eventTarget = new InputGatedEventTarget<{ test: Event }>();
  eventTarget.addEventListener("test", () => t.pass());
  eventTarget.dispatchEvent(new Event("test"));
});
test("InputGatedEventTarget: waits for input gate in add listener context to open before dispatching events", async (t) => {
  const events: number[] = [];
  const inputGate = new InputGate();

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const eventTarget = new InputGatedEventTarget<{ test: Event }>();
  await inputGate.runWith(() => {
    // (e.g. adding WebSocket listener inside Durable Object fetch)
    eventTarget.addEventListener("test", () => {
      events.push(1);
      eventTrigger();
    });
  });

  // Close input gate
  const [openTrigger, openPromise] = triggerPromise<void>();
  void inputGate.runWithClosed(() => openPromise);
  await setTimeout();

  events.push(2);
  // Note dispatch is outside of input gate context (e.g. delivering WebSocket
  // message from network), but still waits for input gate from add listener
  // context to open
  eventTarget.dispatchEvent(new Event("test"));
  events.push(3);
  openTrigger();
  await eventPromise;
  t.deepEqual(events, [2, 3, 1]);
});
