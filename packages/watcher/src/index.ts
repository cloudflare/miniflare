import assert from "assert";
import fs from "fs";
import path from "path";
import { debuglog } from "util";

// TODO: maybe remove this?
const log = debuglog("mf-watch");

function withinDir(dir: string, file: string): boolean {
  // Returns true iff <file> is contained within the <dir>ectory
  // https://stackoverflow.com/a/45242825/
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function walkDirs(root: string, callback: (dir: string) => void) {
  callback(root);
  for (const name of fs.readdirSync(root)) {
    const filePath = path.join(root, name);
    if (!fs.statSync(filePath).isDirectory()) continue;
    walkDirs(filePath, callback);
  }
}

export type WatcherCallback = (path: string) => void;

export interface WatcherOptions {
  // Milliseconds to debounce events for the same resolved path, defaults to 50
  debounce?: number;
  // Milliseconds to poll existing file paths for changes, defaults to 250
  pollInterval?: number;
  // Milliseconds to poll non-existent file paths for creation. Defaults to
  // a slower 1000, as if a file doesn't exist, it's unlikely to be created
  // soon. Even when it gets created, it will probably be empty so the user will
  // need time to fill it out.
  createPollInterval?: number;
  // Force using the non-platform recursive watcher, just for testing, you
  // wouldn't want to do this normally
  forceRecursive?: boolean;
}

class PathWatcher {
  private watchFileListener?: (curr: fs.Stats, prev: fs.Stats) => void;
  private watcher?: fs.FSWatcher;
  private watchers?: Map<string, fs.FSWatcher>;
  private lastMtimes?: Map<string, number>;

  constructor(
    private options: Required<WatcherOptions>,
    private filePath: string,
    private callback: () => void
  ) {}

  private get watching(): boolean {
    return !!(
      this.watchFileListener ||
      this.watcher ||
      this.watchers ||
      this.lastMtimes
    );
  }

  private startCreateWatcher(): void {
    assert(!this.watching);
    log(`${this.filePath}: polling for create...`);
    this.watchFileListener = (curr) => {
      // Ignore invalid events
      if (curr.mtimeMs === 0) return;
      // Stop watching path, start() will watch it again properly
      log(`${this.filePath}: created, tidying up temporary watcher...`);
      fs.unwatchFile(this.filePath, this.watchFileListener);
      this.watchFileListener = undefined;
      // Emit an event for the creation of the file
      this.callback();
      // Try watch the path again now it actually exists
      void this.start();
    };
    fs.watchFile(
      this.filePath,
      { interval: this.options.createPollInterval },
      this.watchFileListener
    );
  }

  private startPollingWatcher(): void {
    assert(!this.watching);
    log(`${this.filePath}: polling...`);
    this.watchFileListener = (curr, prev) => {
      log(`${this.filePath}: ${prev.mtimeMs} -> ${curr.mtimeMs}`);
      // If file deleted, watch for file or directory to be created
      if (curr.mtimeMs === 0) {
        this.callback();
        this.dispose();
        this.startCreateWatcher();
      } else if (curr.mtimeMs !== prev.mtimeMs) {
        this.callback();
      }
    };
    fs.watchFile(
      this.filePath,
      { interval: this.options.pollInterval },
      this.watchFileListener
    );
  }

  // Watch listener for fs.watch()ing directories
  private listener: fs.WatchListener<string> = (event, fileName) => {
    log(`${this.filePath}: ${event}: ${fileName}`);
    // Try to detect and ignore spurious events where mtime is unchanged
    if (fileName) {
      try {
        // filePath will always be a directory when using this listener. We
        // always poll single files, never fs.watch them.
        const resolved = path.resolve(this.filePath, fileName);
        const mtime = fs.statSync(resolved).mtimeMs;
        const previousMtime = this.lastMtimes?.get(resolved);
        if (previousMtime === mtime) {
          log(`${this.filePath}: ${resolved}: ignored spurious event`);
          return;
        }
        this.lastMtimes?.set(resolved, mtime);
      } catch {
        // Ignore errors, doesn't matter too much if we get spurious events
      }
    }
    // Emit event
    this.callback();
    // If root directory deleted, watch for file or directory to be created
    if (!fs.existsSync(this.filePath)) {
      this.dispose();
      this.startCreateWatcher();
    }
  };

  private startDeletedWatcher(): void {
    // Watch for root directory to be deleted, so we can clean up its watchers
    this.watchFileListener = (curr) => {
      if (curr.mtimeMs === 0) {
        this.callback();
        this.dispose();
        this.startCreateWatcher();
      }
    };
    fs.watchFile(
      this.filePath,
      { interval: this.options.pollInterval },
      this.watchFileListener
    );
  }

  private startPlatformRecursiveWatcher(): void {
    assert(!this.watching);
    log(`${this.filePath}: recursively watching with platform...`);
    this.lastMtimes = new Map<string, number>();
    // TODO: what happens when we delete the root on Windows? EPERM?
    this.watcher = fs.watch(this.filePath, { recursive: true }, this.listener);
    this.startDeletedWatcher();
  }

  private startRecursiveWatcher() {
    assert(!this.watching);
    log(`${this.filePath}: recursively watching...`);
    const watchers = (this.watchers = new Map<string, fs.FSWatcher>());
    this.lastMtimes = new Map<string, number>();

    // Callback for watch events: if this was a change to a directory,
    // makes sure the directory, and its subdirectories, are watched.
    //
    // If the directory no longer exists, removes its watchers, and any
    // subdirectories'.
    //
    // dir is the watched directory, fileName is the name of the file
    // within dir that triggered the event.
    const update = (
      dir: string,
      event: fs.WatchEventType,
      fileName: string
    ) => {
      // If dir is no longer a directory, something weird has happened,
      // (e.g. directory deleted and replaced with file of same name)
      // so just reset the watcher
      let dirIsDirectory = false;
      try {
        dirIsDirectory = fs.statSync(dir).isDirectory();
      } catch {}
      if (!dirIsDirectory) {
        // TODO: don't reset the entire watcher if this isn't the root
        log(`${this.filePath}: ${dir} is no longer a directory, resetting...`);
        this.callback();
        this.dispose();
        this.start();
        return;
      }

      // Trigger the user's callback
      const filePath = path.join(dir, fileName);
      this.listener(event, filePath);
      try {
        // If the changed path is a directory, it might be a new one, so
        // make sure it's recursively watched
        if (fs.statSync(filePath).isDirectory()) {
          walkDirs(filePath, walkCallback);
        }
      } catch (e: any) {
        // Rethrow if due to anything other than file not existing
        if (e.code !== "ENOENT") throw e;
        // If the directory no longer exists, remove its watchers, and any
        // subdirectories'
        for (const [watchedPath, watcher] of watchers.entries()) {
          if (filePath === watchedPath || withinDir(filePath, watchedPath)) {
            watcher.close();
            watchers.delete(watchedPath);
          }
        }
      }
      log(`${this.filePath}: watching ${[...watchers.keys()].join(",")}`);
    };

    const walkCallback = (dir: string) => {
      // Only watch directories we aren't watching already
      if (!watchers.has(dir)) {
        watchers.set(dir, fs.watch(dir, update.bind(this, dir)));
      }
    };

    try {
      walkDirs(this.filePath, walkCallback);
      this.startDeletedWatcher();
    } catch (e: any) {
      // Rethrow if due to anything other than file not existing
      if (e.code !== "ENOENT") throw e;
      // Watch for file or directory to be created
      this.dispose();
      this.startCreateWatcher();
    }
  }

  start(): void {
    try {
      // Check whether filePath is a file or directory. This will throw an
      // ENOENT error if filePath doesn't exist, in which case we want to watch
      // for a file or directory to be created.
      if (fs.statSync(this.filePath).isDirectory()) {
        // If this is a directory, try use an efficient platform recursive
        // watcher. This will throw an ERR_FEATURE_UNAVAILABLE_ON_PLATFORM error
        // on Linux, in which case we'll need to walk the directory ourselves.
        // This may also throw an ENOENT error if filePath was deleted between
        // the stat check and now, in which case we want to watch for a file
        // or directory to be created.
        if (this.options.forceRecursive) {
          return this.startRecursiveWatcher();
        } else {
          return this.startPlatformRecursiveWatcher();
        }
      } else {
        // If this is a file, use a polling watcher. We could use the more
        // efficient fs.watch() API here, but this won't detect changes if an
        // editor writes by creating a new file then renaming it to filePath
        // (e.g. macOS TextEdit). Polling isn't too bad here though, since it's
        // only single files. Miniflare specifically will only watch 3 files by
        // default too: wrangler.toml, package.json, and .env.
        return this.startPollingWatcher();
      }
    } catch (e: any) {
      // Cleanup any partially setup watchers
      this.dispose();
      if (e.code === "ENOENT") {
        // If the file doesn't exist, start a polling watcher that waits for
        // a single event then calls start() again. We have to poll here as
        // fs.watch() throws if the file doesn't exist.
        return this.startCreateWatcher();
      }
      if (e.code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
        // If we couldn't use a platform recursive watcher, manually walk the
        // directory ourselves, and watch each directory with fs.watch().
        return this.startRecursiveWatcher();
      }
      // Rethrow any other errors (e.g. permissions)
      throw e;
    }
  }

  dispose() {
    log(`${this.filePath}: disposing...`);

    // Clean up create/polling/deleted watcher
    if (this.watchFileListener) {
      fs.unwatchFile(this.filePath, this.watchFileListener);
      this.watchFileListener = undefined;
    }

    // Clean up platform recursive watcher
    this.watcher?.close();
    this.watcher = undefined;

    // Clean up recursive watcher
    if (this.watchers) {
      for (const watcher of this.watchers.values()) watcher.close();
      this.watchers = undefined;
    }

    this.lastMtimes = undefined;
    assert(!this.watching);
  }
}

export class Watcher {
  readonly #watchers = new Map<string, PathWatcher>();
  readonly #callback: WatcherCallback;
  readonly #options: Required<WatcherOptions>;

  constructor(callback: WatcherCallback, options?: WatcherOptions) {
    this.#callback = callback;
    this.#options = {
      debounce: options?.debounce ?? 50,
      pollInterval: options?.pollInterval ?? 250,
      createPollInterval: options?.createPollInterval ?? 1000,
      forceRecursive: options?.forceRecursive ?? false,
    };
  }

  watch(paths: string | Iterable<string>): void {
    if (typeof paths === "string") paths = [paths];
    for (const rawPath of paths) {
      // Use a consistent absolute path key for the watchers map
      const resolved = path.resolve(rawPath);
      // If we're already watching this path, don't watch it again
      if (this.#watchers.has(resolved)) {
        log(`${resolved}: already watching`);
        continue;
      }
      // Create watcher, debouncing events for the same root path
      log(`${resolved}: watching...`);
      let debounceHandle: NodeJS.Timeout;
      const callback = () => {
        clearTimeout(debounceHandle);
        debounceHandle = setTimeout(
          this.#callback,
          this.#options.debounce,
          resolved
        );
      };
      const watcher = new PathWatcher(this.#options, resolved, callback);
      this.#watchers.set(resolved, watcher);
      watcher.start();
    }
  }

  unwatch(paths: string | Iterable<string>): void {
    if (typeof paths === "string") paths = [paths];
    for (const rawPath of paths) {
      const resolved = path.resolve(rawPath);
      log(`${resolved}: unwatching...`);
      this.#watchers.get(resolved)?.dispose();
      this.#watchers.delete(resolved);
    }
  }

  dispose(): void {
    for (const watcher of this.#watchers.values()) watcher.dispose();
    this.#watchers.clear();
  }
}
