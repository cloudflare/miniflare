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
