import assert from "assert";
import { MemoryStorageFactory } from "@miniflare/shared-test";
import anyTest, { TestInterface } from "ava";
import { AlarmStore } from "../src/alarms";

interface Context {
  alarmStore: AlarmStore;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const factory = new MemoryStorageFactory();
  const alarmStore = new AlarmStore();
  alarmStore.setupStore(factory);
  t.context = { alarmStore };
});

test.afterEach((t) => {
  const { alarmStore } = t.context;
  alarmStore.dispose();
});

test("Alarms: check that a bridge is created", (t) => {
  const { alarmStore } = t.context;
  const bridge = alarmStore.buildBridge("test");
  assert(bridge);
  t.is(typeof bridge.setAlarm, "function");
  t.is(typeof bridge.deleteAlarm, "function");
});

test("Alarms: setupAlarms and call setAlarm immediately", async (t) => {
  t.plan(1);
  const { alarmStore } = t.context;
  await new Promise<null>((resolve) => {
    alarmStore.setupAlarms(async (objectKey) => {
      t.is(objectKey, "test");
      resolve(null);
    });
    alarmStore.setAlarm("test", 1);
  });
});

test("Alarms: wait a second before updating value", async (t) => {
  t.plan(3);
  const { alarmStore } = t.context;
  let value = 3;
  const promise = new Promise<null>((resolve) => {
    alarmStore.setupAlarms(async (objectKey) => {
      t.is(objectKey, "update");
      value++;
      resolve(null);
    });
    alarmStore.setAlarm("update", Date.now() + 1_000);
  });
  t.is(value, 3);
  await promise;
  t.is(value, 4);
});

test("Alarms: setAlarm returns undefined; deleteAlarm", async (t) => {
  const { alarmStore } = t.context;
  const alarm = await alarmStore.setAlarm("toDelete", Date.now() + 50_000);
  t.is(alarm, undefined);
  const deleted = await alarmStore.deleteAlarm("toDelete");
  t.is(deleted, undefined);
  t.pass();
});
test("Alarms: check delete worked via a wait period", async (t) => {
  t.plan(1);
  const { alarmStore } = t.context;
  alarmStore.setupAlarms(async () => {
    t.fail();
  });
  // set first alarm 1 second from now
  await alarmStore.setAlarm("test", Date.now() + 1_000);
  // delete said alarm
  await alarmStore.deleteAlarm("test");
  // wait an appropriate amount of time
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  t.pass();
});

test("Alarms: setupAlarms and call setAlarm through the bridge", async (t) => {
  t.plan(1);
  const { alarmStore } = t.context;
  const bridge = alarmStore.buildBridge("test");
  await new Promise<null>((resolve) => {
    alarmStore.setupAlarms(async (objectKey) => {
      t.is(objectKey, "test");
      resolve(null);
    });
    bridge.setAlarm(1);
  });
});

test("Alarms: setupAlarms and call setAlarm twice. The second one should trigger", async (t) => {
  t.plan(1);
  const { alarmStore } = t.context;
  const now = Date.now();
  await new Promise<null>((resolve) => {
    alarmStore.setupAlarms(async () => {
      t.true(Date.now() - now > 2_000);
      resolve(null);
    });
    // set first alarm 1 second from now
    alarmStore.setAlarm("test", Date.now() + 1_000);
    // set the second 5 seconds from now
    alarmStore.setAlarm("test", Date.now() + 3_000);
  });
});

test("Alarms: setTimeout of 0 throws", async (t) => {
  const { alarmStore } = t.context;
  await t.throwsAsync(async () => {
    await alarmStore.setAlarm("test", 0);
  });
});
