import { Awaitable } from "@miniflare/shared";

// Multi-reader, single-writer lock
export class ReadWriteMutex {
  private readLockCount = 0;
  private writeLocked = false;
  private readResolveQueue: (() => void)[] = [];
  private writeResolveQueue: (() => void)[] = [];

  private readLock(): Awaitable<void> {
    // If no writers waiting, and not write locked, acquire read lock
    if (this.writeResolveQueue.length === 0 && !this.writeLocked) {
      this.readLockCount++;
      return;
    }
    return new Promise((resolve) => this.readResolveQueue.push(resolve));
  }

  private writeLock(): Awaitable<void> {
    // If no readers locking, and not write locked, acquire write lock
    if (this.readLockCount === 0 && !this.writeLocked) {
      this.writeLocked = true;
      return;
    }
    return new Promise((resolve) => this.writeResolveQueue.push(resolve));
  }

  private unlock(): void {
    // Wait until all read locks released before allowing a write lock to be
    // acquired
    if (this.readLockCount > 0) return;
    // Prioritise writers
    if (this.writeResolveQueue.length > 0) {
      this.writeLocked = true;
      return this.writeResolveQueue.shift()?.();
    }
    // If no writers waiting, release all readers
    this.writeLocked = false;
    this.readLockCount += this.readResolveQueue.length;
    for (const resolve of this.readResolveQueue) resolve();
    this.readResolveQueue.splice(0, this.readResolveQueue.length);
  }

  async runWithRead<T>(closure: () => Awaitable<T>): Promise<T> {
    const acquireAwaitable = this.readLock();
    if (acquireAwaitable instanceof Promise) await acquireAwaitable;
    try {
      const awaitable = closure();
      if (awaitable instanceof Promise) return await awaitable;
      return awaitable;
    } finally {
      this.readLockCount--;
      this.unlock();
    }
  }

  async runWithWrite<T>(closure: () => Awaitable<T>): Promise<T> {
    const acquireAwaitable = this.writeLock();
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
