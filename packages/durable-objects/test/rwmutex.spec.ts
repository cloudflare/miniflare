// noinspection ES6MissingAwait

import { setTimeout } from "timers/promises";
import { ReadWriteMutex } from "@miniflare/durable-objects";
import { triggerPromise } from "@miniflare/shared-test";
import test from "ava";

test("ReadWriteMutex: runs read closures concurrently", async (t) => {
  const mutex = new ReadWriteMutex();
  let remaining = 3;
  const [trigger, promise] = triggerPromise<void>();
  const closure = async () => {
    await setTimeout();
    if (--remaining === 0) trigger();
    await promise;
  };
  // This would deadlock if closures not run concurrently
  await Promise.all([
    mutex.runWithRead(closure),
    mutex.runWithRead(closure),
    mutex.runWithRead(closure),
  ]);
  t.pass();
});
test("ReadWriteMutex: runs write closures exclusively", async (t) => {
  const mutex = new ReadWriteMutex();
  const events: number[] = [];
  await Promise.all([
    mutex.runWithWrite(async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    }),
    mutex.runWithWrite(async () => {
      events.push(3);
    }),
  ]);
  if (events[0] === 1) t.deepEqual(events, [1, 2, 3]);
  else t.deepEqual(events, [3, 1, 2]);
});
test("ReadWriteMutex: read and write locks can be acquired synchronously", (t) => {
  const mutex = new ReadWriteMutex();
  let acquired = false;
  mutex.runWithRead(() => (acquired = true));
  t.true(acquired);

  acquired = false;
  mutex.runWithWrite(() => (acquired = true));
  t.true(acquired);
});
test("ReadWriteMutex: writer waits for readers to finish, but future readers wait for writer", async (t) => {
  const mutex = new ReadWriteMutex();
  let writerReleased = false;

  // Acquire multiple read locks
  const [read1Trigger, read1Promise] = triggerPromise<void>();
  const [read2Trigger, read2Promise] = triggerPromise<void>();
  void mutex.runWithRead(() => read1Promise);
  void mutex.runWithRead(() => read2Promise);

  // Try acquire write lock, check forced to wait for readers
  void mutex.runWithWrite(() => (writerReleased = true));
  await setTimeout();
  t.false(writerReleased);

  // Try acquire more read locks
  let remaining = 2;
  const [trigger, promise] = triggerPromise<void>();
  const closure = async () => {
    if (--remaining === 0) trigger();
    await promise;
  };
  const readPromises = Promise.all([
    mutex.runWithRead(closure),
    mutex.runWithRead(closure),
  ]);

  // Release single read lock, check writer not released
  read1Trigger();
  await setTimeout();
  t.false(writerReleased);

  // Release other read lock, check writer released
  read2Trigger();
  await setTimeout();
  t.true(writerReleased);

  // Check readers released concurrently, this would deadlock if closures not
  // run concurrently
  await readPromises;

  // Check more readers can be acquired (synchronously) after this too
  let readerAcquired = false;
  void mutex.runWithRead(() => (readerAcquired = true));
  t.true(readerAcquired);
});
test("ReadWriteMutex: writers prioritised over readers when releasing", async (t) => {
  const mutex = new ReadWriteMutex();
  let events: number[] = [];

  // Check releasing write lock
  let [trigger, promise] = triggerPromise<void>();
  mutex.runWithWrite(() => promise);
  let promise2 = mutex.runWithRead(() => events.push(2));
  let promise1 = mutex.runWithWrite(() => events.push(1));
  trigger();
  await Promise.all([promise2, promise1]);
  t.deepEqual(events, [1, 2]);

  // Check releasing read lock
  events = [];
  [trigger, promise] = triggerPromise<void>();
  mutex.runWithRead(() => promise);
  promise1 = mutex.runWithWrite(() => events.push(1));
  promise2 = mutex.runWithRead(() => events.push(2));
  trigger();
  await setTimeout();
  await Promise.all([promise1, promise2]);
  t.deepEqual(events, [1, 2]);
});
