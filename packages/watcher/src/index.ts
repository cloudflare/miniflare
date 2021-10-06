import fs from "fs";
import path from "path";
import { Log } from "@miniflare/shared";
const fsp = fs.promises;

export function withinDir(dir: string, file: string): boolean {
  // Returns true iff <file> is contained within the <dir>ectory
  // https://stackoverflow.com/a/45242825/
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function walkDirs(root: string, callback: (dir: string) => void) {
  callback(root);
  const names = await fsp.readdir(root);
  await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(root, name);
      if (!(await fsp.stat(filePath)).isDirectory()) return;
      return walkDirs(filePath, callback);
    })
  );
}

export type WatcherCallback = (path: string) => void;

interface Closable {
  close(): void;
}

// TODO: work out why this breaks with macOS TextEdit,
//  maybe check if file, and if it is just use polling fs.watchFile

// TODO: maybe just remove logging, or put behind env variable

export class Watcher {
  readonly #watchers = new Map<string, Map<string, Closable>>();
  readonly #callback: WatcherCallback;
  readonly #log?: (message: string) => void;
  readonly #debounce: number;

  constructor(callback: WatcherCallback, log?: Log, debounce = 50) {
    this.#callback = callback;
    this.#log = log && log.verbose.bind(log);
    this.#debounce = debounce;
  }

  #watchCreated(resolved: string, debounced: () => void): void {
    this.#log?.(`${resolved}: waiting for create...`);
    // Polls <resolved> every second until a file is created there, then stops
    // watching.
    const listener = (curr: fs.Stats) => {
      if (curr.mtimeMs === 0) return;
      this.#log?.(`${resolved}: created, tidying up temporary watcher...`);
      close();
      // Delete the map so watch doesn't think we're already watching the files
      this.#watchers.delete(resolved);
      // Emit an event for creating the file
      debounced();
      // Try watch the path again now the path actually exists
      void this.watch(resolved);
    };
    const close = () => fs.unwatchFile(resolved, listener);
    fs.watchFile(resolved, { interval: 1000 }, listener);

    // Add watcher to the map so it's cleaned-up if path is unwatched before
    // file is created.
    let map = this.#watchers.get(resolved);
    if (!map) {
      map = new Map<string, Closable>();
      this.#watchers.set(resolved, map);
    }
    map.set(resolved, { close });
  }

  async watch(paths: string | Iterable<string>): Promise<void> {
    if (typeof paths === "string") paths = [paths];
    for (const rawPath of paths) {
      // Use a consistent absolute path key for the watchers map
      const resolved = path.resolve(rawPath);
      // If we're already watching this path, don't watch it again
      if (this.#watchers.has(resolved)) {
        this.#log?.(`${resolved}: already watching`);
        continue;
      }

      // Create a map of watched absolute paths to watchers, this tracks
      // watchers to close when unwatching or when directories are deleted
      const map = new Map<string, fs.FSWatcher>();
      this.#watchers.set(resolved, map);

      // Create a map of previous mtimes. Only emit events if mtime changes to
      // avoid emitting on spurious callbacks.
      const mtimeMap = new Map<string, number>();

      // Debounce events for the same root path
      let debounceHandle: NodeJS.Timeout;
      const debounce = async (event?: string, fileName?: string) => {
        this.#log?.(`${resolved}: ${event}: ${fileName}`);
        // Try to detect and ignore spurious events where mtime is unchanged
        if (fileName) {
          try {
            const resolvedStat = await fsp.stat(resolved);
            let filePath = resolved;
            let mtime = resolvedStat.mtimeMs;
            if (resolvedStat.isDirectory()) {
              filePath = path.resolve(resolved, fileName);
              mtime = (await fsp.stat(filePath)).mtimeMs;
            }
            const previousMtime = mtimeMap.get(filePath);
            if (previousMtime === mtime) {
              this.#log?.(`${resolved}: ignored spurious event`);
              return;
            }
            mtimeMap.set(filePath, mtime);
          } catch {
            // Ignore errors, doesn't matter too much if we get spurious events
          }
        }
        clearTimeout(debounceHandle);
        if (!fs.existsSync(resolved)) {
          this.#log?.(`${resolved}: deleted, tidying up watcher...`);
          this.unwatch(resolved);
          this.#watchCreated(resolved, debounce);
          return;
        }
        debounceHandle = setTimeout(this.#callback, this.#debounce, resolved);
      };

      try {
        // Prefer the recursive option, this will only work on macOS or Windows
        map.set(resolved, fs.watch(resolved, { recursive: true }, debounce));
        this.#log?.(`${resolved}: watching recursively...`);
        // TODO: check deleting directory on windows, and other caveats from Node docs
        // TODO: also test moving root watched directory
      } catch (e: any) {
        if (e.code === "ENOENT") {
          this.#watchCreated(resolved, debounce);
          continue;
        }
        if (e.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
          // Rethrow if due to anything other than recursive not being supported
          throw e;
        }

        // Callback for watch events: if this was a change to a directory,
        // makes sure the directory, and its subdirectories, are watched
        //
        // If the directory no longer exists, removes its watchers, and any
        // subdirectories'
        //
        // dir is the watched directory, fileName is the name of the file
        // within dir that triggered the event
        const update = async (dir: string, event: string, fileName: string) => {
          // Trigger the user's callback
          const filePath = path.join(dir, fileName);
          await debounce(event, filePath);
          try {
            // If the changed path is a directory, it might be a new one, so
            // make sure it's recursively watched
            if ((await fsp.stat(filePath)).isDirectory()) {
              await walkDirs(filePath, walkCallback);
            }
          } catch (e: any) {
            // Rethrow if due to anything other than file not existing
            if (e.code !== "ENOENT") throw e;
            // If the directory no longer exists, remove its watchers, and any
            // subdirectories'
            for (const [watched, watcher] of map.entries()) {
              if (filePath === watched || withinDir(filePath, watched)) {
                watcher.close();
                map.delete(watched);
              }
            }
          }
          this.#log?.(`${resolved}: watching ${[...map.keys()].join(",")}`);
        };

        const walkCallback = (dir: string) => {
          // Only watch directories we aren't watching already
          if (!map.has(dir)) {
            map.set(dir, fs.watch(dir, update.bind(this, dir)));
          }
        };

        this.#log?.(`${resolved}: watching with walk...`);
        await walkDirs(resolved, walkCallback);
      }
    }
  }

  unwatch(paths: string | Iterable<string>): void {
    if (typeof paths === "string") paths = [paths];
    for (const rawPath of paths) {
      const resolved = path.resolve(rawPath);
      this.#log?.(`${resolved}: unwatching...`);
      // Remove all watchers associated with the path
      for (const watcher of this.#watchers.get(resolved)?.values() ?? []) {
        watcher.close();
      }
      // Remove the watchers map for this path
      this.#watchers.delete(resolved);
    }
  }
}
