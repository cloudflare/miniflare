import assert from "assert";
import { AsyncLocalStorage } from "async_hooks";

export type MaybePromise<T> = T | Promise<T>;

export class Mutex {
  private locked = false;
  private resolveQueue: (() => void)[] = [];

  private lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.resolveQueue.push(resolve));
  }

  private unlock(): void {
    assert(this.locked);
    if (this.resolveQueue.length > 0) {
      this.resolveQueue.shift()?.();
    } else {
      this.locked = false;
    }
  }

  get hasWaiting(): boolean {
    return this.resolveQueue.length > 0;
  }

  async runWith<T>(closure: () => Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await closure();
    } finally {
      this.unlock();
    }
  }
}

export type Clock = () => number;
export const defaultClock: Clock = () => Date.now();

export function millisToSeconds(millis: number): number {
  return Math.floor(millis / 1000);
}

// TODO: think about a lot more and finish this implementation
/*

let nextEvent = 0;

interface InputGateHandle {
  gate: InputGate;
  event: number;
}

const asyncLocalStorage = new AsyncLocalStorage<InputGateHandle>();

// TODO: call this before delivering results of async I/O
export function waitForInputGate(): MaybePromise<void> {
  const handle = asyncLocalStorage.getStore();
  return handle?.gate.waitFor();
}

export function runWithInputGateClosed<T>(
  closure: () => Promise<T>
): Promise<T> {
  const handle = asyncLocalStorage.getStore();
  return handle ? handle.gate.runClosed(closure) : closure();
}

// Each Durable Object instance will have one of these associated with it
export class InputGate {
  private lockers = 0;
  private lockingEvent?: number;
  private resolveQueue: (() => void)[] = []; // TODO: could store event ID with callback?

  waitFor(): Promise<void> {
    // TODO: want to prioritise same event
    if (this.lockers === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.resolveQueue.push(resolve));
  }

  async runClosed<T>(closure: () => Promise<T>): Promise<T> {
    const event = asyncLocalStorage.getStore()?.event;
    assert(event !== undefined);
    while (this.lockingEvent !== undefined && this.lockingEvent !== event) {
      await this.waitFor();
    }
    this.lockingEvent = event;
    this.lockers++;
    try {
      return await closure();
    } finally {
      this.lockers--;

      await Promise.resolve();
      if (this.lockers === 0) this.lockingEvent = undefined;
      while (this.lockers === 0 && this.resolveQueue.length > 0) {
        this.lockingEvent = undefined;
        this.resolveQueue.shift()?.();
        await Promise.resolve();
      }
    }
  }

  async runGatedEvent<T>(closure: () => Promise<T>): Promise<T> {
    const event = nextEvent++;
    await this.waitFor();
    return asyncLocalStorage.run({ gate: this, event }, closure);
  }
}
*/
