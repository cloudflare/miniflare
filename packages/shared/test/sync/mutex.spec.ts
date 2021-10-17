import { setTimeout } from "timers/promises";
import { Mutex } from "@miniflare/shared";
import test from "ava";

test("Mutex: runs closures exclusively", async (t) => {
  const mutex = new Mutex();
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
});
