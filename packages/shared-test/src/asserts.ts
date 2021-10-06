import assert from "assert";
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
