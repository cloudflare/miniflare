import { DOMException } from "@miniflare/core";
import { waitForOpenInputGate } from "@miniflare/shared";

export function inputGatedSetTimeout<Args extends any[]>(
  callback: (...args: Args) => void,
  ms?: number,
  ...args: Args
): NodeJS.Timeout {
  return setTimeout(
    async (...args) => {
      await waitForOpenInputGate();
      callback(...args);
    },
    ms,
    ...args
  );
}

export function inputGatedSetInterval<Args extends any[]>(
  callback: (...args: Args) => void,
  ms?: number,
  ...args: Args
): NodeJS.Timer {
  return setInterval(
    async (...args) => {
      await waitForOpenInputGate();
      callback(...args);
    },
    ms,
    ...args
  );
}

// Fix for Jest :(, jest-environment-node doesn't include AbortSignal in
// the global scope, but does include AbortController
export const AbortSignal =
  globalThis.AbortSignal ??
  Object.getPrototypeOf(new AbortController().signal).constructor;

// Polyfill `AbortSignal.timeout` as described here:
// https://community.cloudflare.com/t/2021-12-10-workers-runtime-release-notes/334982
// @ts-expect-error `timeout` isn't included in Node.js yet
AbortSignal.timeout ??= (ms?: number) => {
  if (typeof ms !== "number") {
    throw new TypeError(
      "Failed to execute 'timeout' on 'AbortSignal': parameter 1 is not of type 'integer'."
    );
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

export interface SchedulerWaitOptions {
  signal?: AbortSignal;
}

export class Scheduler {
  wait(ms?: number, options?: SchedulerWaitOptions): Promise<void> {
    if (typeof ms !== "number") {
      throw new TypeError(
        "Failed to execute 'wait' on 'Scheduler': parameter 1 is not of type 'integer'."
      );
    }
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => (resolved = true) && resolve(), ms);
      // @ts-expect-error AbortSignal in @types/node is missing EventTarget types
      options?.signal?.addEventListener("abort", () => {
        if (resolved) return;
        clearTimeout(timeout);
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    });
  }
}
