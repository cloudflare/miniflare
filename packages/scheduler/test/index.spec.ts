import { setImmediate } from "timers/promises";
import { BindingsPlugin, ScheduledEvent } from "@miniflare/core";
import {
  Scheduler,
  SchedulerPlugin,
  startScheduler,
} from "@miniflare/scheduler";
import { MaybePromise } from "@miniflare/shared";
import { TestLog, useMiniflare } from "@miniflare/shared-test";
import test from "ava";

// Waiting for CRONs is slow, so mock out node-cron with manual dispatch
function createCronIsh(): [
  dispatch: (cron: string) => Promise<void>,
  cron: Promise<{ default: typeof import("node-cron") }>
] {
  const crons = new Map<string, Set<() => MaybePromise<void>>>();
  const cronIsh: typeof import("node-cron") = {
    validate() {
      return false;
    },
    schedule(cron, func, options) {
      const set: Set<() => void> = crons.get(cron) ?? new Set();
      crons.set(cron, set);
      if (options?.scheduled ?? true) set.add(func);
      // noinspection JSUnusedGlobalSymbols
      return {
        start() {
          set.add(func);
          return this;
        },
        stop() {
          set.delete(func);
          return this;
        },
        destroy() {
          set.delete(func);
        },
        getStatus() {
          return "";
        },
      };
    },
  };
  const dispatch = async (cron: string) => {
    await Promise.all(Array.from(crons.get(cron) ?? []).map((func) => func()));
  };
  return [dispatch, Promise.resolve({ default: cronIsh })];
}

test("Scheduler: schedules tasks for validated CRONs on reload", async (t) => {
  let events: ScheduledEvent[] = [];
  const log = new TestLog();
  const mf = useMiniflare(
    { SchedulerPlugin, BindingsPlugin },
    {
      globals: { eventCallback: (event: ScheduledEvent) => events.push(event) },
      script: 'addEventListener("scheduled", eventCallback)',
      crons: ["15 * * * *", "30 * * * *"],
    },
    log
  );
  await mf.getPlugins(); // Wait for initial reload
  const [dispatch, cronish] = createCronIsh();
  new Scheduler(mf, cronish);
  await setImmediate();

  // Check scheduler requires reload to schedule tasks
  await dispatch("15 * * * *");
  t.deepEqual(events, []);

  // Check tasks scheduled on reload and logged when dispatched
  await mf.reload();
  log.logs = [];
  await dispatch("15 * * * *");
  t.is(events.length, 1);
  t.is(events[0].cron, "15 * * * *");
  t.regex(log.logs[0][1], /^SCHD 15 \* \* \* \* \(\d+\.\d+ms\)$/);

  events = [];
  log.logs = [];
  await dispatch("30 * * * *");
  t.is(events.length, 1);
  t.is(events[0].cron, "30 * * * *");
  t.regex(log.logs[0][1], /^SCHD 30 \* \* \* \* \(\d+\.\d+ms\)$/);
});
test("Scheduler: destroys tasks when CRONs change", async (t) => {
  const events: ScheduledEvent[] = [];
  // noinspection JSUnusedGlobalSymbols
  const options = {
    globals: { eventCallback: (event: ScheduledEvent) => events.push(event) },
    script: 'addEventListener("scheduled", eventCallback)',
    crons: ["15 * * * *"],
  };
  const mf = useMiniflare({ SchedulerPlugin, BindingsPlugin }, options);
  await mf.getPlugins(); // Wait for initial reload
  const [dispatch, cronish] = createCronIsh();
  new Scheduler(mf, cronish);
  await mf.reload(); // Schedule tasks

  t.is(events.length, 0);
  await dispatch("15 * * * *");
  t.is(events.length, 1);

  // Update options and check task destroyed
  await mf.setOptions({ ...options, crons: ["30 * * * *"] });
  await dispatch("15 * * * *");
  t.is(events.length, 1);
  await dispatch("30 * * * *");
  t.is(events.length, 2);
});

test("Scheduler: dispose: destroys tasks and removes reload listener", async (t) => {
  const events: ScheduledEvent[] = [];
  const mf = useMiniflare(
    { SchedulerPlugin, BindingsPlugin },
    {
      globals: { eventCallback: (event: ScheduledEvent) => events.push(event) },
      script: 'addEventListener("scheduled", eventCallback)',
      crons: ["15 * * * *"],
    }
  );
  await mf.getPlugins(); // Wait for initial reload
  const [dispatch, cronish] = createCronIsh();
  const scheduler = new Scheduler(mf, cronish);
  await mf.reload(); // Schedule tasks

  t.is(events.length, 0);
  await dispatch("15 * * * *");
  t.is(events.length, 1);

  scheduler.dispose();
  await dispatch("15 * * * *");
  t.is(events.length, 1);
});

test("createScheduler: automatically schedules tasks", async (t) => {
  const events: ScheduledEvent[] = [];
  const mf = useMiniflare(
    { SchedulerPlugin, BindingsPlugin },
    {
      globals: { eventCallback: (event: ScheduledEvent) => events.push(event) },
      script: 'addEventListener("scheduled", eventCallback)',
      crons: ["15 * * * *"],
    }
  );
  await mf.getPlugins(); // Wait for initial reload
  const [dispatch, cronish] = createCronIsh();
  await startScheduler(mf, cronish);
  t.is(events.length, 0);
  await dispatch("15 * * * *");
  t.is(events.length, 1);
});
