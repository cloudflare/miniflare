import {
  Clock,
  Storage,
  StorageOperator,
  StorageTransaction,
  StoredKey,
  StoredValueMeta,
  millisToSeconds,
} from "@miniflare/shared";
import { ExecutionContext } from "ava";
import { isWithin, triggerPromise, utf8Encode } from "test:@miniflare/shared";

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

export interface TestOperatorFactory {
  name: string;
  usesActualTime: boolean;
  usesSkipMetadata: boolean;
  usesListCursor: boolean;
  operatorFactory(t: ExecutionContext, seed: Seed): Promise<StorageOperator>;
}

export abstract class TestStorageFactory implements TestOperatorFactory {
  abstract name: string;
  usesActualTime = false;
  usesSkipMetadata = false;
  usesListCursor = true;
  operatorFactory = (
    t: ExecutionContext,
    seed: Seed
  ): Promise<StorageOperator> => this.factory(t, seed);

  abstract factory(t: ExecutionContext, seed: Seed): Promise<Storage>;

  transactionOperatorFactory(): TestOperatorFactory {
    return {
      name: `${this.name}.transaction`,
      usesActualTime: this.usesActualTime,
      usesSkipMetadata: this.usesSkipMetadata,
      usesListCursor: false,
      operatorFactory: async (t, seed) => {
        const storage = await this.factory(t, seed);
        const [setupTrigger, setupPromise] = triggerPromise();
        const [teardownTrigger, teardownPromise] = triggerPromise();
        let result: StorageTransaction;
        // noinspection ES6MissingAwait
        storage.transaction(async (txn) => {
          result = txn;
          setupTrigger(undefined);
          await teardownPromise;
          txn.rollback();
        });
        await setupPromise;
        t.teardown(() => teardownTrigger(undefined));
        // @ts-expect-error passed setupPromise so result must've been assigned
        // noinspection JSUnusedAssignment
        return result;
      },
    };
  }
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
