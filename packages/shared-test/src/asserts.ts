import assert from "assert";
import { setTimeout } from "timers/promises";
import { RequestContext } from "@miniflare/shared";
import { ExecutionContext } from "ava";

export function noop(): void {}

export function isWithin(
  t: ExecutionContext,
  epsilon: number,
  actual?: number,
  expected?: number
): void {
  t.not(actual, undefined);
  t.not(expected, undefined);
  assert(actual !== undefined && expected !== undefined);
  const difference = Math.abs(actual - expected);
  t.true(
    difference <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}, difference is ${difference}`
  );
}

export function startsWith<T>(
  t: ExecutionContext,
  actual: T[],
  expected: T[]
): void {
  t.deepEqual(
    actual.slice(0, expected.length),
    expected,
    "actual array does not start with expected"
  );
}

export function endsWith<T>(
  t: ExecutionContext,
  actual: T[],
  expected: T[]
): void {
  t.deepEqual(
    actual.slice(actual.length - expected.length),
    expected,
    "actual array does not end with expected"
  );
}

export function getObjectProperties<T>(obj: T): string[] {
  return [
    ...Object.getOwnPropertyNames(obj),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(obj)),
  ]
    .filter((property) => property !== "constructor")
    .sort();
}

export async function advancesTime<T>(
  t: ExecutionContext,
  closure: () => Promise<T>
) {
  const ctx = new RequestContext();
  const previous = ctx.currentTime;
  await setTimeout(50);
  t.is(ctx.currentTime, previous);
  const result = await ctx.runWith(closure);
  t.not(ctx.currentTime, previous);
  return result;
}

export function unusable<T extends object>(): T {
  return new Proxy({} as T, {
    apply() {
      throw new TypeError("Attempted to call unusable object");
    },
    construct() {
      throw new TypeError("Attempted to construct unusable object");
    },
    deleteProperty(target, prop) {
      throw new TypeError(
        `Attempted to delete \"${String(prop)}\" on unusable object`
      );
    },
    get(target, prop) {
      throw new TypeError(
        `Attempted to get \"${String(prop)}\" on unusable object`
      );
    },
    set(target, prop) {
      throw new TypeError(
        `Attempted to set \"${String(prop)}\" on unusable object`
      );
    },
  });
}
