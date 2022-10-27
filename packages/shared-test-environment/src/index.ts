import {
  MiniflareCore,
  MiniflareCoreContext,
  MiniflareCoreOptions,
  createFetchMock,
} from "@miniflare/core";
import { Context, NoOpLog } from "@miniflare/shared";
import { createMiniflareEnvironmentUtilities } from "./globals";
import { PLUGINS } from "./plugins";

export * from "./plugins";
export * from "./storage";
export { ExecutionContext } from "./globals";
export type { MiniflareEnvironmentUtilities } from "./globals";

const log = new NoOpLog();

export async function createMiniflareEnvironment(
  ctx: Pick<
    MiniflareCoreContext,
    "storageFactory" | "scriptRunner" | "queueBroker"
  >,
  options: MiniflareCoreOptions<typeof PLUGINS>,
  globalOverrides?: Context
): Promise<[mf: MiniflareCore<typeof PLUGINS>, globals: Context]> {
  const fetchMock = createFetchMock();
  const mf = new MiniflareCore(
    PLUGINS,
    {
      log,
      ...ctx,
      // Only run the script if we're using Durable Objects and need to have
      // access to the exported classes. This means we're only running the
      // script in modules mode, so we don't need to worry about
      // addEventListener being called twice (once when the script is run, and
      // again when the user imports the worker in Jest tests).
      scriptRunForModuleExports: true,
    },
    {
      // Autoload configuration files from default locations by default,
      // like the CLI (but allow the user to disable this/customise locations)
      wranglerConfigPath: true,
      packagePath: true,
      envPathDefaultFallback: true,

      // Apply user's custom Miniflare options
      ...options,

      globals: {
        ...(options?.globals as any),
        ...globalOverrides,
      },

      // These options cannot be overwritten:
      // - We get the global scope once, so watch mode wouldn't do anything,
      //   apart from stopping Jest exiting
      watch: false,
      // - Persistence must be disabled for stacked storage to work
      kvPersist: false,
      d1Persist: false,
      r2Persist: false,
      cachePersist: false,
      durableObjectsPersist: false,
      // - Allow all global operations, tests will be outside of a request
      //   context, but we definitely want to allow people to access their
      //   namespaces, perform I/O, etc.
      globalAsyncIO: true,
      globalTimers: true,
      globalRandom: true,
      // - Use the actual `Date` class. We'll be operating outside a request
      //   context, so we'd be returning the actual time anyway, and this
      //   might mess with Jest's own mocking.
      actualTime: true,
      // - We always want getMiniflareFetchMock() to return this MockAgent
      fetchMock,
    }
  );

  const mfGlobalScope = await mf.getGlobalScope();
  mfGlobalScope.global = global;
  mfGlobalScope.self = global;

  // Attach Miniflare utility methods to global
  const mfUtilities = await createMiniflareEnvironmentUtilities(mf, fetchMock);
  Object.assign(mfGlobalScope, mfUtilities);

  return [mf, mfGlobalScope];
}
