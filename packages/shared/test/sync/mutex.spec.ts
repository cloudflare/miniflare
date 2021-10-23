import { setTimeout } from "timers/promises";
import { Mutex } from "@miniflare/shared";
import test from "ava";

test("Mutex: runs closures exclusively", async (t) => {
  const mutex = new Mutex();
  const events: number[] = [];
  await Promise.all([
    mutex.runWith(async () => {
      events.push(1);
      await setTimeout();
      events.push(2);
    }),
    mutex.runWith(async () => {
      events.push(3);
    }),
  ]);
  if (events[0] === 1) t.deepEqual(events, [1, 2, 3]);
  else t.deepEqual(events, [3, 1, 2]);
});
test("Mutex: lock can be acquired synchronously", (t) => {
  const mutex = new Mutex();
  let acquired = false;
  mutex.runWith(() => (acquired = true));
  t.true(acquired);
});
