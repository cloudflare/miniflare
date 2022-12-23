import { QueueBroker } from "@miniflare/queues";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  ExecutionContext,
  StackedMemoryStorageFactory,
  createMiniflareEnvironment,
} from "@miniflare/shared-test-environment";
import {
  Environment,
  SuiteAPI,
  SuiteFactory,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
} from "vitest";
import { createChainable } from "./chain";

declare global {
  function setupMiniflareIsolatedStorage(): typeof describe;
}

const scriptRunner = new VMScriptRunner();
const queueBroker = new QueueBroker();

function setupIsolatedStorage(storageFactory: StackedMemoryStorageFactory) {
  // `push()`/`pop()` at the start/end of each test
  beforeEach(() => storageFactory.push());
  afterEach(() => storageFactory.pop());

  // `push()`/`pop()` at the start/end of each `describe` block
  // (users must use the returned `describe` function instead of the default
  // `describe`/`suite` from the `vitest` module)
  const wrappedDescribeFn: typeof describe.fn = function (name, factory) {
    if (typeof factory !== "function") {
      return describe.fn.call(this, name, factory);
    }
    const newFactory: SuiteFactory = (test) => {
      beforeAll(() => storageFactory.push());
      afterAll(() => storageFactory.pop());
      return factory(test);
    };
    return describe.fn.call(this, name, newFactory);
  };

  // https://github.com/vitest-dev/vitest/blob/69d55bc19c8ca6e1dfb28724eb55a45aefc37562/packages/vitest/src/runtime/suite.ts#L204-L215
  const wrappedDescribe = wrappedDescribeFn as typeof describe;
  wrappedDescribe.each = describe.each;
  wrappedDescribe.skipIf = (condition) =>
    (condition ? wrappedChainable.skip : wrappedChainable) as SuiteAPI;
  wrappedDescribe.runIf = (condition) =>
    (condition ? wrappedChainable : wrappedChainable.skip) as SuiteAPI;

  const wrappedChainable = createChainable(
    // https://github.com/vitest-dev/vitest/blob/69d55bc19c8ca6e1dfb28724eb55a45aefc37562/packages/vitest/src/runtime/suite.ts#L217-L220
    ["concurrent", "shuffle", "skip", "only", "todo"],
    wrappedDescribe
  );
  return wrappedChainable as typeof describe;
}

export default <Environment>{
  name: "miniflare",
  async setup(global, options) {
    // Create a Miniflare instance
    const storageFactory = new StackedMemoryStorageFactory();
    const [mf, mfGlobalScope] = await createMiniflareEnvironment(
      { storageFactory, scriptRunner, queueBroker },
      options,
      { ExecutionContext }
    );

    // Attach isolated storage setup function
    mfGlobalScope.setupMiniflareIsolatedStorage = () =>
      setupIsolatedStorage(storageFactory);

    // `crypto` is defined as a getter on the global scope in Node 19+,
    // so attempting to set it with `Object.assign()` would fail. Instead,
    // override the getter with a new value.
    const crypto = mfGlobalScope.crypto;
    delete mfGlobalScope.crypto;
    Object.defineProperty(global, "crypto", { get: () => crypto });

    // Attach all Miniflare  globals to `global`, recording originals to restore
    // in teardown
    const keys = Object.keys(mfGlobalScope);
    const originals = new Map<string, any>();
    for (const key of keys) {
      if (key in global) originals.set(key, global[key]);
    }
    Object.assign(global, mfGlobalScope);

    return {
      teardown(global) {
        // Restore original global values...
        for (const key of keys) {
          if (originals.has(key)) {
            global[key] = originals.get(key);
          } else {
            delete global[key];
          }
        }
        // ...and tidy up
        return mf.dispose();
      },
    };
  },
};
