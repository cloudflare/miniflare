import assert from "assert";
import { promises as fs, rmdirSync } from "fs";
import { setTimeout } from "timers/promises";
import exitHook from "exit-hook";

const kPath = Symbol("kPath");

// Release all acquired locks on exit
const acquired = new Set<FileMutexHandle>();
exitHook(() => {
  for (const mutex of acquired) {
    try {
      rmdirSync(mutex[kPath]);
    } catch {}
  }
});

class FileMutexHandle {
  readonly [kPath]: string;
  private updateInterval?: NodeJS.Timer;

  constructor(path: string, private readonly staleTimeout: number) {
    this[kPath] = path;
    // Make sure we release the lock on exit
    acquired.add(this);
    // Update the directory's mtime regularly so it doesn't go stale
    this.updateInterval = setInterval(
      this.update.bind(this),
      this.staleTimeout / 2
    );
    // Allow the program to exit if the updater is still running, the exit
    // hook will take care of releasing the lock
    this.updateInterval.unref();
  }

  private reset(): void {
    assert(acquired.has(this) && this.updateInterval);
    // Remove the updater and mark the lock as released
    clearInterval(this.updateInterval);
    this.updateInterval = undefined;
    acquired.delete(this);
  }

  private async update(): Promise<void> {
    try {
      // Make sure our instance has acquired the lock
      assert(acquired.has(this));
      // Update the mtime on the directory so the lock doesn't go stale
      const mtime = Date.now() / 1000;
      await fs.utimes(this[kPath], mtime, mtime);
      // TODO: should error if takes longer than staleTimeout
    } catch (e) {
      // If we couldn't update the mtime, allow the lock to go stale
      this.reset();
      throw e;
    }
  }

  async unlock(): Promise<void> {
    this.reset();
    // Release the lock by removing the directory
    await fs.rmdir(this[kPath]);
  }
}

export class FileMutex {
  constructor(
    private readonly path: string,
    private readonly staleTimeout: number = 10_000,
    private readonly pollInterval: number = 50
  ) {}

  private async lock(): Promise<FileMutexHandle> {
    // Keep trying to acquire the lock until we do
    while (true) {
      try {
        // Atomic operation: either the directory doesn't exist and is created
        // or it does and an error is thrown. We use the existence of the
        // directory to denote whether the lock is held.
        await fs.mkdir(this.path);
        // Now acquired lock, so return
        return new FileMutexHandle(this.path, this.staleTimeout);
      } catch (e: any) {
        // EEXIST means the directory already existed and the lock is acquired
        // by someone else. Anything else is a problem.
        if (e.code !== "EEXIST") throw e;
      }
      try {
        // Check if the lock is stale (hasn't been updated for a while).
        // This probably means it wasn't released properly.
        const stat = await fs.stat(this.path);
        if (stat.mtimeMs < Date.now() - this.staleTimeout) {
          // If the lock is stale, force release it and try to acquire it next
          // time round the loop.
          await fs.rmdir(this.path);
        } else {
          // Otherwise, wait for a bit before trying to acquire the lock again.
          await setTimeout(this.pollInterval);
        }
      } catch (e: any) {
        // ENOENT means the lock didn't exist when we tried to stat/remove it.
        // In either case, this just means the lock was released between trying
        // to acquire it and now, so try acquire it again. Anything else is a
        // problem.
        if (e.code !== "ENOENT") throw e;
      }
    }
  }

  async runWith<T>(closure: () => Promise<T>): Promise<T> {
    const handle = await this.lock();
    try {
      return await closure();
    } finally {
      await handle.unlock();
    }
  }
}
