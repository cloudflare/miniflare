import { InputGate, MaybePromise, OutputGate } from "@miniflare/shared";
import { ExecutionContext } from "ava";

export function triggerPromise<T>(): [
  trigger: (result: T) => void,
  promise: Promise<T>
] {
  let trigger: (result: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (trigger = resolve));
  return [trigger, promise];
}

// Exported for use by WebSocket tests, whilst these could use waitsForInputGate
// as is, we'd like to dispatch events outside of the input gate context as
// would happen for real.
export class TestInputGate extends InputGate {
  #waitedTrigger: () => void;
  waitedPromise: Promise<void>;
  #waitedForOpen = false;

  constructor() {
    super();
    [this.#waitedTrigger, this.waitedPromise] = triggerPromise<void>();
  }

  resetWaitedPromise(): void {
    [this.#waitedTrigger, this.waitedPromise] = triggerPromise<void>();
    this.#waitedForOpen = false;
  }

  waitForOpen(): Promise<void> {
    // Only trigger on second waitForOpen(). runWith() will implicitly call this
    // function but we want to trigger only when the closure calls waitForOpen()
    // itself. This isn't a problem for output gates, as they call waitForOpen()
    // after the closure has finished running.
    if (this.#waitedForOpen) this.#waitedTrigger();
    else this.#waitedForOpen = true;
    return super.waitForOpen();
  }
}

export async function waitsForInputGate<T>(
  t: ExecutionContext,
  closure: () => Promise<T>
): Promise<T> {
  const inputGate = new TestInputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();

  const events: number[] = [];
  const promise = inputGate.runWith(async () => {
    // Close input gate (inside runWith as runWith waits for gate to be open
    // before running closure, so would deadlock if already closed)
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    const result = await closure();
    events.push(1);
    return result;
  });
  await inputGate.waitedPromise;
  events.push(2);
  openTrigger();
  await promise;
  t.deepEqual(events, [2, 1]);
  return promise;
}

class TestOutputGate extends OutputGate {
  readonly #waitedTrigger: () => void;
  readonly waitedPromise: Promise<void>;

  constructor() {
    super();
    [this.#waitedTrigger, this.waitedPromise] = triggerPromise<void>();
  }

  waitForOpen(): Promise<void> {
    this.#waitedTrigger();
    return super.waitForOpen();
  }
}

export async function waitsForOutputGate<T>(
  t: ExecutionContext,
  closure: () => MaybePromise<T>,
  observed: () => MaybePromise<any>
): Promise<T> {
  // Create and close output gate
  const outputGate = new TestOutputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();
  outputGate.waitUntil(openPromise);

  const promise = outputGate.runWith(closure);
  await outputGate.waitedPromise;
  t.falsy(await observed());
  openTrigger();
  await promise;
  t.truthy(await observed());
  return promise;
}
