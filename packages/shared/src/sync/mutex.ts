import assert from "assert";
import { Awaitable } from "@miniflare/shared";

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

  async runWith<T>(closure: () => Promise<T>): Promise<T> {
    await this.lock();
    try {
      return await closure();
    } finally {
      this.unlock();
    }
  }
}
