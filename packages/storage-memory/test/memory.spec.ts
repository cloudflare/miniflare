import { Storage, StoredValueMeta } from "@miniflare/shared";
import { MemoryStorage } from "@miniflare/storage-memory";
import test, { ExecutionContext } from "ava";
import {
  TestStorageFactory,
  operatorMacros,
  testClock,
  txnMacros,
} from "./helpers";

class MemoryStorageFactory extends TestStorageFactory {
  name = "MemoryStorage";

  async factory(
    t: ExecutionContext,
    seed: Record<string, StoredValueMeta>
  ): Promise<Storage> {
    const map = new Map(Object.entries(seed));
    return new MemoryStorage(map, testClock);
  }
}

const storageFactory = new MemoryStorageFactory();
const transactionOperatorFactory = storageFactory.transactionOperatorFactory();

for (const macro of operatorMacros) {
  test(macro, storageFactory);
  test(macro, transactionOperatorFactory);
}
for (const macro of txnMacros) {
  test(macro, storageFactory);
}
