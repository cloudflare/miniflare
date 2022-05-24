import { existsSync, mkdirSync } from "fs";
import { readFile, readdir, unlink, writeFile } from "fs/promises";
import path from "path";

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
  #persist: string | false;
  // 'objectName:hexId' -> DurableObjectAlarm [pulled from plugin.getObject]
  #alarms: Map<string, DurableObjectAlarm> = new Map();
  #alarmInterval: NodeJS.Timeout | undefined;
  constructor(rootPath: string, persist: boolean | string | undefined) {
    if (persist === true) {
      this.#persist = path.join(rootPath, ".mf", "alarms");
    } else if (typeof persist === "string") {
      this.#persist = path.resolve(persist, "alarms");
    } else {
      this.#persist = false;
    }
    // if directory does not exist create
    if (this.#persist) {
      if (!existsSync(this.#persist))
        mkdirSync(this.#persist, { recursive: true });
    }
  }

  // build a map of all alarms from file storage if persist
  async setupStore() {
    if (typeof this.#persist !== "string") return;
    const alarmList = await readdir(this.#persist);
    for (const alarm of alarmList) {
      const alarmPath = path.join(this.#persist, alarm);
      const alarmData = await readFile(alarmPath);
      this.#alarms.set(alarm, { scheduledTime: Number(alarmData) });
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
    this.#alarms.set(objectKey, {
      scheduledTime,
    });
    // if persist, store the alarm in file storage
    if (typeof this.#persist === "string") {
      const alarmPath = path.join(this.#persist, objectKey);
      await writeFile(alarmPath, String(scheduledTime));
    }
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
    if (typeof this.#persist === "string") {
      const alarmPath = path.join(this.#persist, key);
      await unlink(alarmPath);
    }
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
