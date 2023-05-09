import assert from "assert";
import { Awaitable } from "./types";

export type DeferredPromiseResolve<T> = (value: T | PromiseLike<T>) => void;
export type DeferredPromiseReject = (reason?: any) => void;

export class DeferredPromise<T> extends Promise<T> {
  readonly resolve: DeferredPromiseResolve<T>;
  readonly reject: DeferredPromiseReject;

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void
    ) => void = () => {}
  ) {
    let promiseResolve: DeferredPromiseResolve<T>;
    let promiseReject: DeferredPromiseReject;
    super((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
      return executor(resolve, reject);
    });
    // Cannot access `this` until after `super`
    this.resolve = promiseResolve!;
    this.reject = promiseReject!;
  }
}

export class Mutex {
  private locked = false;
  private resolveQueue: (() => void)[] = [];

  private lock(): Awaitable<void> {
    if (!this.locked) {
      this.locked = true;
      return;
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

  async runWith<T>(closure: () => Awaitable<T>): Promise<T> {
    const acquireAwaitable = this.lock();
    if (acquireAwaitable instanceof Promise) await acquireAwaitable;
    try {
      const awaitable = closure();
      if (awaitable instanceof Promise) return await awaitable;
      return awaitable;
    } finally {
      this.unlock();
    }
  }
}

export class WaitGroup {
  private counter = 0;
  private resolveQueue: (() => void)[] = [];

  add(): void {
    this.counter++;
  }

  done(): void {
    assert(this.counter > 0);
    this.counter--;
    if (this.counter === 0) {
      let resolve: (() => void) | undefined;
      while ((resolve = this.resolveQueue.shift()) !== undefined) resolve();
    }
  }

  wait(): Promise<void> {
    if (this.counter === 0) return Promise.resolve();
    return new Promise((resolve) => this.resolveQueue.push(resolve));
  }
}
