import { Storage, StoredValueMeta } from "@miniflare/shared";
import {
  TestStorageFactory,
  storageMacros,
  testClock,
} from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import test, { ExecutionContext } from "ava";

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
for (const macro of storageMacros) {
  test(macro, storageFactory);
}
