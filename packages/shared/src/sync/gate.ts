import assert from "assert";
import { AsyncLocalStorage } from "async_hooks";
// Import `setImmediate` to ensure we use an un-mocked version for I/O gates:
// https://github.com/cloudflare/miniflare/issues/190
import { setImmediate } from "timers";
import { setImmediate as setImmediatePromise } from "timers/promises";
import { TypedEventTarget, kWrapListener } from "../event";
import { Awaitable } from "./awaitable";

const inputGateStorage = new AsyncLocalStorage<InputGate>();
const outputGateStorage = new AsyncLocalStorage<OutputGate>();

/**
 * Waits for the context's input gate (if any) to be open before returning.
 * Should be called before returning result of async I/O (e.g. setTimeout, KV).
 */
export function waitForOpenInputGate(): Awaitable<void> {
  const inputGate = inputGateStorage.getStore();
  return inputGate?.waitForOpen();
}

/**
 * Runs closure with the context's input gate (if any) closed, unless
 * allowConcurrency is true. Should be called when performing storage
 * operations.
 */
export function runWithInputGateClosed<T>(
  closure: () => Promise<T>,
  allowConcurrency = false
): Promise<T> {
  if (allowConcurrency) return closure();
  const inputGate = inputGateStorage.getStore();
  if (inputGate === undefined) return closure();
  return inputGate.runWithClosed(closure);
}

/**
 * Waits for the context's output gate (if any) to be open before returning.
 * Should be called before making async I/O requests (e.g. fetch, KV put)
 * which may be using unconfirmed values.
 */
export function waitForOpenOutputGate(): Awaitable<void> {
  const outputGate = outputGateStorage.getStore();
  return outputGate?.waitForOpen();
}

/**
 * Registers promise with context's output gate (if any) unless allowUnconfirmed
 * is true. Should be called immediately (before any await) if returning a
 * promise for a storage write operation.
 */
export function waitUntilOnOutputGate<T>(
  promise: Promise<any>,
  allowUnconfirmed = false
): Promise<T> {
  if (allowUnconfirmed) return promise;
  const outputGate = outputGateStorage.getStore();
  outputGate?.waitUntil(promise);
  return promise;
}

export class InputGate {
  #lockCount = 0;
  readonly #resolveQueue: (() => void)[] = [];
  readonly #parent?: InputGate;

  constructor(parent?: InputGate) {
    this.#parent = parent;
  }

  /** Waits for input gate to open, then runs closure under the input gate */
  async runWith<T>(closure: () => Awaitable<T>): Promise<T> {
    await this.waitForOpen();
    return inputGateStorage.run(this, closure);
  }

  /** Waits for input gate to be open (e.g. before returning from async I/O) */
  async waitForOpen(): Promise<void> {
    // Wait until JavaScript has finished running (next task) before checking if
    // closed. If many waitForOpen's followed by runWithClosed's are called
    // concurrently, this ensures the *2nd* is blocked until after the *1st*s
    // runWithClosed completes. More concretely, if there are 2 concurrent
    // fetches to a Durable Object that get unique numbers, this will ensure
    // 1 of the fetches runs first, followed sequentially by the other.
    await setImmediatePromise();
    // If no locks, gate is already open so just return...
    if (this.#lockCount === 0) return;
    // ...otherwise add to waiter queue
    return new Promise((resolve) => this.#resolveQueue.push(resolve));
  }

  /**
   * Runs a closure with this input gate closed (e.g. performing Durable Object
   * storage operation, blockConcurrencyWhile). Once complete, if the gate is
   * now open, resolves some waiters.
   */
  async runWithClosed<T>(closure: () => Promise<T>): Promise<T> {
    this.#lock();
    // Wait until JavaScript has finished running (next microtask) before
    // running closure
    await Promise.resolve();
    const childInputGate = new InputGate(/* parent */ this);
    try {
      return await inputGateStorage.run(childInputGate, closure);
    } finally {
      // Wait until JavaScript has finished running (next task) before resolving
      // waiters. Note we're not awaiting this as that wouldn't give the caller
      // a chance to make other locking calls which we want to prioritise.
      setImmediate(this.#unlock);
    }
  }

  #lock(): void {
    // Make sure gate is closed. Multiple concurrent callers can have the gate
    // closed, so we need to keep track of how many there are so we know when
    // it's open again.
    this.#lockCount++; // undone in #unlock()
    if (this.#parent) this.#parent.#lock();
  }

  #unlock = async (): Promise<void> => {
    // Don't unlock until AFTER setImmediate, allows caller to lock again
    // (e.g. put immediately following get)
    assert(this.#lockCount > 0);
    this.#lockCount--;
    // Resolve waiters until locked or none left, do this before unlocking
    // parent (if any) so they have priority
    while (this.#lockCount === 0 && this.#resolveQueue.length) {
      this.#resolveQueue.shift()!();
      // Allow resolved waiter to acquire lock before trying to release more
      await setImmediatePromise();
    }
    // If we reach this point and there are still waiters in resolveQueue, then
    // this.lockCount must be > 0. Every increment of lockCount is eventually
    // followed by a call to unlock so we'll eventually run this again
    // and resolve the remaining waiters.

    if (this.#parent) return this.#parent.#unlock();
  };
}

export class OutputGate {
  readonly #waitUntil: Promise<unknown>[] = [];

  /** Runs closure under the output gate, then waits for output gate to open */
  async runWith<T>(closure: () => Awaitable<T>): Promise<T> {
    try {
      return await outputGateStorage.run(this, closure);
    } finally {
      await this.waitForOpen();
    }
  }

  /** Waits for promises registered with this gate via waitUntil to resolve */
  async waitForOpen(): Promise<void> {
    await Promise.all(this.#waitUntil);
  }

  /**
   * Registers a promise with this output gate. The gate won't open until this
   * promise resolves.
   */
  waitUntil(promise: Promise<any>): void {
    this.#waitUntil.push(promise);
  }
}

export class InputGatedEventTarget<
  EventMap extends Record<string, Event>
> extends TypedEventTarget<EventMap> {
  protected [kWrapListener]<Type extends keyof EventMap>(
    listener: (event: EventMap[Type]) => void
  ): (event: EventMap[Type]) => void {
    // Get input gate from the add/remove event listener context, not dispatch
    const inputGate = inputGateStorage.getStore();
    return inputGate
      ? async (event) => {
          await inputGate.waitForOpen();
          listener(event);
        }
      : listener;
  }
}
