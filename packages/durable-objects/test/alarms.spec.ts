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

test("Alarms: delete alarm before use", async (t) => {
  const { alarmStore } = t.context;
  const alarm = await alarmStore.setAlarm("toDelete", Date.now() + 50_000);
  t.is(alarm, undefined);
  await alarmStore.deleteAlarm("toDelete");
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
