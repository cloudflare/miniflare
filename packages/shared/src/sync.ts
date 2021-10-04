import assert from "assert";

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
