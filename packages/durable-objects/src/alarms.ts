import assert from "assert";
import { Storage, StorageFactory } from "@miniflare/shared";

export interface DurableObjectSetAlarmOptions {
  allowConcurrency?: boolean;
  allowUnconfirmed?: boolean;
}

export interface DurableObjectGetAlarmOptions {
  allowConcurrency?: boolean;
}

export interface DurableObjectAlarmBridge {
  setAlarm: (scheduledTime: number | Date) => Promise<void>;
  deleteAlarm: () => Promise<void>;
}

export interface DurableObjectAlarm {
  scheduledTime: number;
  timeout?: NodeJS.Timeout;
}

export const ALARM_KEY = "__MINIFLARE_ALARMS__";

export class AlarmStore {
  #store?: Storage;
  // 'objectName:hexId' -> DurableObjectAlarm [pulled from plugin.getObject]
  #alarms: Map<string, DurableObjectAlarm> = new Map();
  #alarmTimeout?: NodeJS.Timeout;

  // build a map of all alarms from file storage if persist
  async setupStore(storage: StorageFactory, persist?: boolean | string) {
    // pull in the store & iterate the store for all alarms
    this.#store = await storage.storage(ALARM_KEY, persist);
    const { keys } = await this.#store.list<{ scheduledTime: number }>(
      {},
      false
    );
    for (const { name, metadata } of keys) {
      this.#alarms.set(name, { scheduledTime: metadata?.scheduledTime || 0 });
    }
  }

  // any alarms 30 seconds in the future or sooner are returned
  async setupAlarms(callback: (objectKey: string) => Promise<void>) {
    if (this.#alarmTimeout) return;
    const now = Date.now();

    // iterate the store. For every alarm within 30 seconds of now,
    // setup a timeout and run the callback and then delete the alarm
    for (const [objectKey, doAlarm] of this.#alarms) {
      const { scheduledTime } = doAlarm;
      if (scheduledTime < now + 30_000) {
        doAlarm.timeout = setTimeout(() => {
          this.#deleteAlarm(objectKey, doAlarm);
          callback(objectKey);
        }, Math.max(scheduledTime - now, 0));
      }
    }

    // set up the "interval" to check for alarms. By calling this after
    // setting up the alarms, we can gaurentee active alarms are flushed
    // prior to our next check.
    this.#alarmTimeout = setTimeout(() => {
      this.#alarmTimeout = undefined;
      this.setupAlarms(callback);
    }, 30_000);
  }

  buildBridge(objectKey: string): DurableObjectAlarmBridge {
    return {
      setAlarm: (scheduledTime: number | Date) =>
        this.setAlarm(objectKey, scheduledTime),
      deleteAlarm: () => this.deleteAlarm(objectKey),
    };
  }

  async setAlarm(objectKey: string, scheduledTime: number | Date) {
    if (typeof scheduledTime !== "number")
      scheduledTime = scheduledTime.getTime();
    // set the alarm in the store
    this.#alarms.set(objectKey, { scheduledTime });
    // if persist, store the alarm in file storage
    await this.#store?.put(objectKey, {
      metadata: { scheduledTime },
      value: new Uint8Array(),
    });
  }

  async deleteAlarm(key: string) {
    const alarm = this.#alarms.get(key);
    if (alarm) await this.#deleteAlarm(key, alarm);
  }

  async #deleteAlarm(key: string, alarm: DurableObjectAlarm) {
    // delete the timeout should it exist
    if (alarm.timeout) clearTimeout(alarm.timeout);
    // delete the alarm from the store
    this.#alarms.delete(key);
    // if persist, delete from storage
    assert(this.#store);
    await this.#store.delete(key);
  }

  dispose() {
    // clear the primary "intervals"
    if (this.#alarmTimeout) {
      clearTimeout(this.#alarmTimeout);
      this.#alarmTimeout = undefined;
    }
    // clear all alarms
    for (const doAlarm of this.#alarms.values()) {
      if (doAlarm.timeout) clearTimeout(doAlarm.timeout);
    }
    // clear the store
    this.#alarms.clear();
  }
}
