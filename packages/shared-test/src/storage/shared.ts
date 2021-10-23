import {
  Clock,
  Storage,
  StoredKey,
  StoredValueMeta,
  millisToSeconds,
} from "@miniflare/shared";
import { ExecutionContext } from "ava";
import { isWithin } from "../asserts";
import { utf8Encode } from "../data";

// Stored expiration value to signal an expired key. Storages using actual
// time should interpret this as the current time.
export const TIME_EXPIRED = 500;
// Time in seconds the testClock always returns:
// TIME_EXPIRED < TIME_NOW < TIME_EXPIRING
export const TIME_NOW = 750;
// Stored expiration value to signal a key that will expire in the future.
// Storages using actual time should interpret this as the current time + 1hr.
// Tests will check the expiry is within 120s of this.
export const TIME_EXPIRING = 1000;

export const testClock: Clock = () => TIME_NOW * 1000;

const now = millisToSeconds(Date.now());
export const expectedActualExpiring = now + 3600;

export function assertExpiring(
  t: ExecutionContext,
  usesActualTime?: boolean,
  actual?: number
): number | undefined {
  if (usesActualTime) {
    isWithin(t, 120, actual, expectedActualExpiring);
  } else {
    t.is(actual, TIME_EXPIRING);
  }
  return actual;
}

export function keyNames(keys: StoredKey[]): string[] {
  return keys.map(({ name }) => name);
}

export type Seed = Record<string, StoredValueMeta>;

export abstract class TestStorageFactory {
  abstract name: string;
  usesActualTime = false;
  usesSkipMetadata = false;
  abstract factory(t: ExecutionContext, seed: Seed): Promise<Storage>;
}

export const MIXED_SEED: Seed = {
  key1: {
    value: utf8Encode("value1"),
  },
  key2: {
    value: utf8Encode("value2"),
    expiration: TIME_EXPIRING,
    metadata: { testing: true },
  },
  key3: {
    value: utf8Encode("expired"),
    expiration: TIME_EXPIRED,
  },
  "dir/key4": {
    value: utf8Encode("value3"),
  },
};

export const SECTION_SEED: Seed = {
  section1key1: { value: utf8Encode("value11") },
  section1key2: { value: utf8Encode("value12") },
  section2key1: { value: utf8Encode("value21") },
  section2key2: { value: utf8Encode("value22") },
  section3key1: { value: utf8Encode("value31") },
  section3key2: { value: utf8Encode("value32") },
};
