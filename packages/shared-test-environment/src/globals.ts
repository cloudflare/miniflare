import {
  FetchEvent,
  MiniflareCore,
  ScheduledEvent,
  kWaitUntil,
  waitUntilAll,
} from "@miniflare/core";
import {
  DurableObject,
  DurableObjectId,
  DurableObjectState,
  DurableObjectStorage,
  _kRunWithGates,
} from "@miniflare/durable-objects";
import { Awaitable, Context } from "@miniflare/shared";
import { MockAgent } from "undici";
import { PLUGINS } from "./plugins";

export class ExecutionContext {
  [kWaitUntil]: Promise<unknown>[] = [];

  passThroughOnException(): void {}

  waitUntil(promise: Promise<any>): void {
    this[kWaitUntil].push(promise);
  }
}

export interface MiniflareEnvironmentUtilities {
  getMiniflareBindings<Bindings = Context>(): Bindings;
  getMiniflareDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage>;
  getMiniflareDurableObjectState(
    id: DurableObjectId
  ): Promise<DurableObjectState>;
  getMiniflareDurableObjectInstance(
    id: DurableObjectId
  ): Promise<DurableObject>;
  runWithMiniflareDurableObjectGates<T>(
    state: DurableObjectState,
    closure: () => Awaitable<T>
  ): Promise<T>;
  getMiniflareFetchMock(): MockAgent;
  getMiniflareWaitUntil<WaitUntil extends any[] = unknown[]>(
    event: FetchEvent | ScheduledEvent | ExecutionContext
  ): Promise<WaitUntil>;
  flushMiniflareDurableObjectAlarms(ids: DurableObjectId[]): Promise<void>;
  getMiniflareDurableObjectIds(namespace: string): Promise<DurableObjectId[]>;
}

export async function createMiniflareEnvironmentUtilities(
  mf: MiniflareCore<typeof PLUGINS>,
  fetchMock: MockAgent
): Promise<MiniflareEnvironmentUtilities> {
  // Add a way of getting bindings in modules mode to allow seeding data.
  // These names are intentionally verbose, so they don't collide with anything
  // else in scope.
  const bindings = await mf.getBindings();
  return {
    getMiniflareBindings<Bindings>() {
      return bindings as Bindings;
    },
    async getMiniflareDurableObjectStorage(id: DurableObjectId) {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const factory = mf.getPluginStorage("DurableObjectsPlugin");
      return plugin.getStorage(factory, id);
    },
    async getMiniflareDurableObjectState(id: DurableObjectId) {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const factory = mf.getPluginStorage("DurableObjectsPlugin");
      const storage = plugin.getStorage(factory, id);
      return new DurableObjectState(id, storage);
    },
    async getMiniflareDurableObjectInstance(id: DurableObjectId) {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const factory = mf.getPluginStorage("DurableObjectsPlugin");
      return await plugin.getInstance(factory, id);
    },
    runWithMiniflareDurableObjectGates<T>(
      state: DurableObjectState,
      closure: () => Awaitable<T>
    ) {
      return state[_kRunWithGates](closure);
    },
    getMiniflareFetchMock() {
      return fetchMock;
    },
    getMiniflareWaitUntil<WaitUntil extends any[] = unknown[]>(
      event: FetchEvent | ScheduledEvent | ExecutionContext
    ): Promise<WaitUntil> {
      return waitUntilAll<WaitUntil>(event[kWaitUntil]);
    },
    async flushMiniflareDurableObjectAlarms(ids?: DurableObjectId[]) {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const factory = mf.getPluginStorage("DurableObjectsPlugin");
      return plugin.flushAlarms(factory, ids);
    },
    async getMiniflareDurableObjectIds(
      namespace: string
    ): Promise<DurableObjectId[]> {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const factory = mf.getPluginStorage("DurableObjectsPlugin");
      return plugin.getObjects(factory, namespace);
    },
  };
}
