import fs from "fs/promises";
import path from "path";
import { TransformStream } from "stream/web";
import { setImmediate, setTimeout } from "timers/promises";
import { useTmp } from "@miniflare/shared-test";
import { Watcher } from "@miniflare/watcher";
import test, { ExecutionContext, Macro } from "ava";

interface WatcherEvents {
  count: number;
  next: () => Promise<string>;
}

function useWatcher(
  t: ExecutionContext,
  forceRecursive?: boolean
): [watcher: Watcher, events: WatcherEvents] {
  const { readable, writable } = new TransformStream<string, string>();
  const reader = readable.getReader();
  const writer = writable.getWriter();
  const events: WatcherEvents = {
    count: 0,
    next: async () => (await reader.read()).value ?? "",
  };

  const watcher = new Watcher(
    (path) => {
      events.count++;
      void writer.write(path);
    },
    { pollInterval: 50, createPollInterval: 50, forceRecursive }
  );
  t.teardown(() => watcher.dispose());
  return [watcher, events];
}

test.serial(
  "PathWatcher: startCreatedWatcher: watches for file to be created",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test.txt");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(testPath);
    await setImmediate();

    await fs.writeFile(testPath, "test");
    t.is(await events.next(), testPath);
    t.is(events.count, 1);
  }
);
test.serial(
  "PathWatcher: startCreatedWatcher: watches for directory to be created",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(testPath);
    await setImmediate();

    await fs.mkdir(testPath);
    t.is(await events.next(), testPath);
    t.is(events.count, 1);
  }
);

test.serial(
  "PathWatcher: startPollingWatcher: watches single files",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test.txt");
    await fs.writeFile(testPath, "test");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(testPath);
    await setImmediate();

    await fs.writeFile(testPath, "test2");
    t.is(await events.next(), testPath);
    t.is(events.count, 1);
  }
);
test.serial(
  "PathWatcher: startPollingWatcher: watches for file to be created again if deleted",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test.txt");
    await fs.writeFile(testPath, "test");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(testPath);
    await setImmediate();

    await fs.rm(testPath);
    t.is(await events.next(), testPath);
    t.is(events.count, 1);

    await fs.writeFile(testPath, "test");
    t.is(await events.next(), testPath);
    t.is(events.count, 2);
  }
);
test.serial(
  "PathWatcher: startPollingWatcher: handles file being replaced by rename",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test.txt");
    const testTmpPath = testPath + "~";
    await fs.writeFile(testPath, "0");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(testPath);
    await setImmediate();

    await fs.writeFile(testTmpPath, "1");
    await setTimeout(100);
    t.is(events.count, 0);
    await fs.rename(testTmpPath, testPath);
    t.is(await events.next(), testPath);
    t.is(events.count, 1);

    await fs.writeFile(testTmpPath, "2");
    await setTimeout(100);
    t.is(events.count, 1);
    await fs.rename(testTmpPath, testPath);
    t.is(await events.next(), testPath);
    t.is(events.count, 2);
  }
);

const recursiveTitle =
  (title: string) => (providedTitle?: string, force?: boolean) =>
    `PathWatcher: start${force ? "" : "Platform"}RecursiveWatcher: ${title}`;

const recursiveRootMacro: Macro<[force?: boolean]> = async (t, force) => {
  const tmp = await useTmp(t);
  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(tmp);

  await fs.writeFile(path.join(tmp, "test.txt"), "value");
  t.is(await events.next(), tmp);
  await fs.mkdir(path.join(tmp, "test"));
  t.is(await events.next(), tmp);
};
recursiveRootMacro.title = recursiveTitle("watches files in root directory");
test.serial(recursiveRootMacro);
test.serial(recursiveRootMacro, true);

const recursiveNestedMacro: Macro<[force?: boolean]> = async (t, force) => {
  const tmp = await useTmp(t);
  const nestedDir = path.join(tmp, "nested");
  await fs.mkdir(nestedDir);
  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(tmp);

  await fs.writeFile(path.join(nestedDir, "test.txt"), "value");
  t.is(await events.next(), tmp);
  await fs.mkdir(path.join(nestedDir, "test"));
  t.is(await events.next(), tmp);
};
recursiveNestedMacro.title = recursiveTitle(
  "watches files in nested directory"
);
test.serial(recursiveNestedMacro);
test.serial(recursiveNestedMacro, true);

const recursiveNewMacro: Macro<[force?: boolean]> = async (t, force) => {
  const tmp = await useTmp(t);
  const nestedDir = path.join(tmp, "nested");
  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(tmp);
  await setImmediate();

  await fs.mkdir(nestedDir);
  await fs.writeFile(path.join(nestedDir, "test.txt"), "value");
  t.is(await events.next(), tmp);
  await fs.mkdir(path.join(nestedDir, "test"));
  t.is(await events.next(), tmp);
};
recursiveNewMacro.title = recursiveTitle(
  "watches files in newly created directory"
);
test.serial(recursiveNewMacro);
test.serial(recursiveNewMacro, true);

const recursiveNewNestedMacro: Macro<[force?: boolean]> = async (t, force) => {
  const tmp = await useTmp(t);
  const tmp1 = path.join(tmp, "1");
  const tmp2 = path.join(tmp, "2");

  const tmp2Dir = path.join(tmp2, "dir");
  const tmp2Nested = path.join(tmp2Dir, "nested");
  const tmp2NestedFile = path.join(tmp2Nested, "test.txt");

  await fs.mkdir(tmp1);
  await fs.mkdir(tmp2Nested, { recursive: true });
  await fs.writeFile(tmp2NestedFile, "1");

  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(tmp1);
  await setImmediate();

  // Move tmp2 to inside tmp1
  const newTmp2 = path.join(tmp1, "tmp2");
  await fs.rename(tmp2, newTmp2);
  t.is(await events.next(), tmp1);
  await setTimeout(100);
  t.is(events.count, 1);

  // Update tmp2NestedFile in tmp1
  await fs.writeFile(path.join(newTmp2, "dir", "nested", "test.txt"), "2");
  t.is(await events.next(), tmp1);
  t.is(events.count, 2);

  // Create new file in dir
  await fs.writeFile(path.join(newTmp2, "dir", "new1.txt"), "1");
  t.is(await events.next(), tmp1);
  t.is(events.count, 3);

  // Create new file in nested dir
  await fs.writeFile(path.join(newTmp2, "dir", "nested", "new2.txt"), "2");
  t.is(await events.next(), tmp1);
  t.is(events.count, 4);
};
recursiveNewNestedMacro.title = recursiveTitle(
  "watches files in newly created nested directories"
);
test.serial(recursiveNewNestedMacro);
test.serial(recursiveNewNestedMacro, true);

const recursiveNestedDeleteMacro: Macro<[force?: boolean]> = async (
  t,
  force
) => {
  const tmp = await useTmp(t);
  const nestedDir = path.join(tmp, "nested");
  const nestedTestPath = path.join(nestedDir, "test.txt");
  await fs.mkdir(nestedDir);

  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(tmp);
  await setImmediate();

  // Delete nested directory
  await fs.rmdir(nestedDir);
  t.is(await events.next(), tmp);
  await setTimeout(100);
  t.is(events.count, 1);

  // Recreate directory
  await fs.mkdir(nestedDir);
  t.is(await events.next(), tmp);
  t.is(events.count, 2);

  // Create file in directory
  await fs.writeFile(nestedTestPath, "2");
  t.is(await events.next(), tmp);
  t.is(events.count, 3);
};
recursiveNestedDeleteMacro.title = recursiveTitle(
  "handles nested directory being deleted and recreated again"
);
test.serial(recursiveNestedDeleteMacro);
test.serial(recursiveNestedDeleteMacro, true);

const recursiveRootDeleteMacro: Macro<[force?: boolean]> = async (t, force) => {
  const tmp = await useTmp(t);
  const root = path.join(tmp, "root");
  const newRoot = path.join(tmp, "root2");
  const newRootDir = path.join(newRoot, "dir");
  const newRootDirNested = path.join(newRootDir, "nested");
  const newRootDirNestedFile = path.join(newRootDirNested, "test.txt");
  await fs.mkdir(root);
  await fs.mkdir(newRootDirNested, { recursive: true });
  await fs.writeFile(newRootDirNestedFile, "1");

  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(root);
  await setImmediate();

  // Delete root directory and move new root in it's place
  await fs.rmdir(root);
  t.is(await events.next(), root);
  await setTimeout(100);
  t.is(events.count, 1);
  await fs.rename(newRoot, root);
  t.is(await events.next(), root);
  t.is(events.count, 2);

  // Update file in newly copied root
  await fs.writeFile(path.join(root, "dir", "nested", "test.txt"), "2");
  t.is(await events.next(), root);
  t.is(events.count, 3);
};
recursiveRootDeleteMacro.title = recursiveTitle(
  "handles root directory being deleted and recreated again"
);
test.serial(recursiveRootDeleteMacro);
test.serial(recursiveRootDeleteMacro, true);

const recursiveRootReplaceFileMacro: Macro<[force?: boolean]> = async (
  t,
  force
) => {
  const tmp = await useTmp(t);
  const root = path.join(tmp, "root");
  await fs.mkdir(root);

  const [watcher, events] = useWatcher(t, force);
  await watcher.watch(root);
  await setImmediate();

  // Delete root directory and replace with file
  await fs.rmdir(root);
  t.is(await events.next(), root);
  await setTimeout(100);
  t.is(events.count, 1);
  await fs.writeFile(root, "1");
  t.is(await events.next(), root);
  t.is(events.count, 2);
  await fs.writeFile(root, "2");
  t.is(await events.next(), root);
  t.is(events.count, 3);
};
recursiveRootReplaceFileMacro.title = recursiveTitle(
  "handles root directory being deleted and replaced with file of same name"
);
test.serial(recursiveRootReplaceFileMacro);
test.serial(recursiveRootReplaceFileMacro, true);

test.serial("PathWatcher: dispose: cleans up polling watchers", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "1");

  const [watcher, events] = useWatcher(t);
  await watcher.watch(testPath);
  watcher.dispose();

  await fs.writeFile(testPath, "1");
  await setTimeout(100);
  t.is(events.count, 0);
});
test.serial(
  "PathWatcher: dispose: cleans up platform recursive watchers",
  async (t) => {
    const tmp = await useTmp(t);
    const testPath = path.join(tmp, "test.txt");
    await fs.writeFile(testPath, "1");

    const [watcher, events] = useWatcher(t);
    await watcher.watch(tmp);
    watcher.dispose();

    await fs.writeFile(testPath, "1");
    await setTimeout(100);
    t.is(events.count, 0);
  }
);
test.serial("PathWatcher: dispose: cleans up recursive watchers", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "1");

  const [watcher, events] = useWatcher(t, true);
  await watcher.watch(tmp);
  watcher.dispose();

  await fs.writeFile(testPath, "1");
  await setTimeout(100);
  t.is(events.count, 0);
});

test.serial("Watcher: watches and un-watches files", async (t) => {
  const tmp = await useTmp(t);
  const test1Path = path.join(tmp, "test1.txt");
  const test2Path = path.join(tmp, "test2.txt");
  await fs.writeFile(test1Path, "test1 value1");
  await fs.writeFile(test2Path, "test2 value1");

  const [watcher, events] = useWatcher(t);
  await watcher.watch([test1Path, test2Path]);

  // Check event emitted on change
  await fs.writeFile(test2Path, "test2 value2");
  t.is(await events.next(), test2Path);

  // Unwatch file and check no longer watcher
  watcher.unwatch(test2Path);
  await fs.writeFile(test2Path, "test2 value2");
  await setTimeout(100);
  await fs.writeFile(test1Path, "test1 value2");
  t.is(await events.next(), test1Path);
});
test.serial("Watcher: watches files once", async (t) => {
  const tmp = await useTmp(t);
  const testPath = path.join(tmp, "test.txt");
  await fs.writeFile(testPath, "value1");

  const [watcher, events] = useWatcher(t);
  await watcher.watch([testPath, testPath]);
  await watcher.watch(testPath);
  await fs.writeFile(testPath, "value2");
  t.is(await events.next(), testPath);
  await setTimeout(100);
  t.is(events.count, 1);
});
test.serial("Watcher: dispose: cleans up watchers", async (t) => {
  const tmp = await useTmp(t);
  const test1Path = path.join(tmp, "test1.txt");
  const test2Path = path.join(tmp, "test2.txt");
  await fs.writeFile(test1Path, "test1 value1");
  await fs.writeFile(test2Path, "test2 value1");

  const [watcher, events] = useWatcher(t);
  await watcher.watch([test1Path, test2Path]);

  watcher.dispose();

  await fs.writeFile(test1Path, "test1 value2");
  await fs.writeFile(test2Path, "test2 value2");
  await setTimeout(100);
  t.is(events.count, 0);
});
