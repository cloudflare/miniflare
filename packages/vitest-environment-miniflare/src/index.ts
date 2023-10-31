/* eslint-disable es/no-dynamic-import */
// noinspection ES6ConvertVarToLetConst

import stream from "stream/web";
import { QueueBroker } from "@miniflare/queues";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  ExecutionContext,
  StackedMemoryStorageFactory,
  createMiniflareEnvironment,
} from "@miniflare/shared-test-environment";
import { createChainable } from "@vitest/runner/utils";
import type { Environment, SuiteAPI, SuiteFactory, describe } from "vitest";

const scriptRunner = new VMScriptRunner();
const queueBroker = new QueueBroker();

function setupIsolatedStorage(
  vitestImpl: typeof import("vitest"),
  storageFactory: StackedMemoryStorageFactory
) {
  // `push()`/`pop()` at the start/end of each test
  vitestImpl.beforeEach(() => storageFactory.push());
  vitestImpl.afterEach(() => storageFactory.pop());

  // `push()`/`pop()` at the start/end of each `describe` block
  // (users must use the returned `describe` function instead of the default
  // `describe`/`suite` from the `vitest` module)
  const wrappedDescribeFn: typeof describe.fn = function (name, factory) {
    if (typeof factory !== "function") {
      return vitestImpl.describe.fn.call(this, name, factory);
    }
    const newFactory: SuiteFactory = (test) => {
      vitestImpl.beforeAll(() => storageFactory.push());
      vitestImpl.afterAll(() => storageFactory.pop());
      return factory(test);
    };
    return vitestImpl.describe.fn.call(this, name, newFactory);
  };

  // https://github.com/vitest-dev/vitest/blob/69d55bc19c8ca6e1dfb28724eb55a45aefc37562/packages/vitest/src/runtime/suite.ts#L204-L215
  const wrappedDescribe = wrappedDescribeFn as typeof describe;
  wrappedDescribe.each = vitestImpl.describe.each;
  wrappedDescribe.skipIf = (condition) =>
    (condition ? wrappedChainable.skip : wrappedChainable) as SuiteAPI;
  wrappedDescribe.runIf = (condition) =>
    (condition ? wrappedChainable : wrappedChainable.skip) as SuiteAPI;

  // https://github.com/vitest-dev/vitest/blob/e691a9ca229dd84765a4b40192761ffc1827069c/packages/runner/src/suite.ts#L228
  const wrappedChainable = createChainable(
    ["concurrent", "shuffle", "skip", "only", "todo"],
    wrappedDescribe
  );
  return wrappedChainable as typeof describe;
}

declare global {
  // eslint-disable-next-line no-var
  var ReadableStream: typeof stream.ReadableStream;
  // eslint-disable-next-line no-var
  var WritableStream: typeof stream.WritableStream;
  // eslint-disable-next-line no-var
  var TransformStream: typeof stream.TransformStream;
}

export default <Environment>{
  name: "miniflare",
  transformMode: "ssr",
  async setup(global, options) {
    const vitestImpl = await import("vitest");

    // Since `undici@5.14.0`, stream classes are loaded from the global scope
    // if available (https://github.com/nodejs/undici/pull/1793). Make sure
    // `undici` sets module variables for stream classes before we assign
    // Miniflare's versions. Accessing these would throw if the
    // `streams_enable_constructors` compatibility flag wasn't enabled.
    globalThis.ReadableStream = stream.ReadableStream;
    globalThis.WritableStream = stream.WritableStream;
    globalThis.TransformStream = stream.TransformStream;
    // @ts-expect-error `undici` doesn't provide type definitions for internals
    await import("undici/lib/fetch/index.js");

    // Create a Miniflare instance
    const storageFactory = new StackedMemoryStorageFactory();
    const [mf, mfGlobalScope] = await createMiniflareEnvironment(
      { storageFactory, scriptRunner, queueBroker },
      options,
      { ExecutionContext }
    );

    // Attach isolated storage setup function
    mfGlobalScope.setupMiniflareIsolatedStorage = () =>
      setupIsolatedStorage(vitestImpl, storageFactory);

    // `crypto` is defined as a getter on the global scope in Node 19+,
    // so attempting to set it with `Object.assign()` would fail. Instead,
    // override the getter with a new value.
    const crypto = mfGlobalScope.crypto;
    delete mfGlobalScope.crypto;
    Object.defineProperty(global, "crypto", { get: () => crypto });

    // `navigator` is defined as a getter on the global scope in Node 21+,
    // so attempting to set it with `Object.assign()` would fail. Instead,
    // override the getter with a new value.
    const navigator = mfGlobalScope.navigator;
    delete mfGlobalScope.navigator;
    Object.defineProperty(global, "navigator", { get: () => navigator });

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
