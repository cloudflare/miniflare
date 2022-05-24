import { TextDecoder, TextEncoder } from "util";
import { Storage, StorageFactory } from "@miniflare/shared";

export type DurableObjectScheduledAlarm = number | Date;

export interface DurableObjectSetAlarmOptions {
  allowConcurrency?: boolean;
  allowUnconfirmed?: boolean;
}

export interface DurableObjectGetAlarmOptions {
  allowConcurrency?: boolean;
}

export interface DurableObjectAlarmBridge {
  setAlarm(scheduledTime: number): void;
  deleteAlarm(): void;
}

export type DurableObjectAlarm = {
  scheduledTime: number;
  timeout?: NodeJS.Timeout;
};

export class AlarmStore {
  #store: Storage | undefined;
  // 'objectName:hexId' -> DurableObjectAlarm [pulled from plugin.getObject]
  #alarms: Map<string, DurableObjectAlarm> = new Map();
  #alarmInterval: NodeJS.Timeout | undefined;

  // build a map of all alarms from file storage if persist
  async setupStore(storage: StorageFactory, persist?: boolean | string) {
    if (persist) {
      // pull in the store & iterate the store for all alarms
      this.#store = await storage.storage("__MINIFLARE_ALARMS__", persist);
      const { keys } = (await this.#store?.list({}, true)) || { keys: [] };
      for (const { name } of keys) {
        // grab, parse, than set in memory.
        const { value } = (await this.#store?.get(name, true)) || {
          value: new Uint8Array(),
        };
        const scheduledTime = Number(new TextDecoder().decode(value));
        this.#alarms.set(name, { scheduledTime });
      }
    }
  }

  // any alarms 30 seconds in the future or sooner are returned
  async setupAlarms(cb: (objectKey: string, scheduledTime: number) => void) {
    if (this.#alarmInterval) return;
    const now = Date.now();

    // iterate the store. For every alarm within 30 seconds of now,
    // setup a timeout and run the callback and then delete the alarm
    for (const [objectKey, doAlarm] of this.#alarms) {
      const { scheduledTime } = doAlarm;
      if (scheduledTime < now + 30_000) {
        doAlarm.timeout = setTimeout(() => {
          this.#deleteAlarm(objectKey, doAlarm);
          cb(objectKey, scheduledTime);
        }, Math.max(scheduledTime - now, 0));
      }
    }

    // set up the "interval" to check for alarms. By calling this after
    // setting up the alarms, we can gaurentee active alarms are flushed
    // prior to our next check.
    this.#alarmInterval = setTimeout(() => {
      this.#alarmInterval = undefined;
      this.setupAlarms(cb);
    }, 30_000);
  }

  buildBridge(objectKey: string): DurableObjectAlarmBridge {
    return {
      setAlarm: (scheduledTime: number) => {
        this.setAlarm(objectKey, scheduledTime);
      },
      deleteAlarm: () => {
        this.deleteAlarm(objectKey);
      },
    };
  }

  async setAlarm(objectKey: string, scheduledTime: number) {
    // set the alarm in the store
    this.#alarms.set(objectKey, { scheduledTime });
    // if persist, store the alarm in file storage
    this.#store?.put(objectKey, {
      value: new Uint8Array(new TextEncoder().encode(String(scheduledTime))),
    });
  }

  async deleteAlarm(key: string) {
    if (this.#alarms.has(key))
      await this.#deleteAlarm(key, this.#alarms.get(key));
  }

  async #deleteAlarm(key: string, alarm: DurableObjectAlarm | undefined) {
    // delete the timeout should it exist
    if (alarm?.timeout) clearTimeout(alarm.timeout);
    // delete the alarm from the store
    this.#alarms.delete(key);
    // if persist, delete from storage
    this.#store?.delete(key);
  }

  dispose() {
    // clear the primary "intervals"
    if (this.#alarmInterval) {
      clearTimeout(this.#alarmInterval);
      this.#alarmInterval = undefined;
    }
    // clear all alarms
    for (const doAlarm of this.#alarms.values()) {
      if (doAlarm.timeout) clearTimeout(doAlarm.timeout);
    }
    // clear the store
    this.#alarms.clear();
  }
}
