import childProcess from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import { setTimeout } from "timers/promises";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { FileMutex } from "@miniflare/storage-file";
import test from "ava";
import { useTmp } from "test:@miniflare/shared";

const execFile = promisify(childProcess.execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.join(__dirname, "..", "..", "test", "fixtures");

test("FileMutex: runs closures exclusively", async (t) => {
  const tmp = await useTmp(t);
  const lockPath = path.join(tmp, "test.lock");
  const mutex = new FileMutex(lockPath);
  const results: number[] = [];
  await Promise.all([
    mutex.runWith(async () => {
      results.push(1);
      await setTimeout();
      results.push(2);
    }),
    mutex.runWith(async () => {
      results.push(3);
    }),
  ]);
  if (results[0] === 1) t.deepEqual(results, [1, 2, 3]);
  else t.deepEqual(results, [3, 1, 2]);
  // Check lock file deleted when unlocked
  t.false(existsSync(lockPath));
});
test("FileMutex: updates mtime regularly", async (t) => {
  const tmp = await useTmp(t);
  const lockPath = path.join(tmp, "test.lock");
  const mutex = new FileMutex(lockPath, 100);
  await mutex.runWith(async () => {
    // mtime should be updated every 50ms (100ms / 2)
    let stat = await fs.stat(lockPath);
    let lastMtime = stat.mtimeMs;
    await setTimeout(75);

    stat = await fs.stat(lockPath);
    t.not(stat.mtimeMs, lastMtime);
    lastMtime = stat.mtimeMs;
    await setTimeout(75);

    stat = await fs.stat(lockPath);
    t.not(stat.mtimeMs, lastMtime);
  });
});
test("FileMutex: detects stale locks", async (t) => {
  const tmp = await useTmp(t);
  const lockPath = path.join(tmp, "test.lock");
  await fs.mkdir(lockPath);
  await setTimeout(100);
  const mutex = new FileMutex(lockPath, 50);
  await mutex.runWith(async () => t.pass());
});
test("FileMutex: cleans up acquired locks on exit", async (t) => {
  const tmp = await useTmp(t);
  const lockPath = path.join(tmp, "test.lock");
  const fixturePath = path.join(fixturesPath, "sync.exitHook.js");
  await t.throwsAsync(execFile(process.execPath, [fixturePath, lockPath]), {
    // Lock must've been acquired to return this code
    code: 42,
  });
  // Check lock file deleted by exit hook
  t.false(existsSync(lockPath));
});
