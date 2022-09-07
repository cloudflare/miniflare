import { MiniflareCore } from "@miniflare/core";
import {
  DurableObjectId,
  DurableObjectStorage,
} from "@miniflare/durable-objects";
import { Context } from "@miniflare/shared";
import { MockAgent } from "undici";
import { PLUGINS } from "./plugins";

declare global {
  function getMiniflareBindings<Bindings = Context>(): Bindings;
  function getMiniflareDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage>;
  function getMiniflareFetchMock(): MockAgent;
  function flushMiniflareDurableObjectAlarms(
    ids: DurableObjectId[]
  ): Promise<void>;
}

export interface MiniflareEnvironmentUtilities {
  getMiniflareBindings<Bindings = Context>(): Bindings;
  getMiniflareDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage>;
  getMiniflareFetchMock(): MockAgent;
  flushMiniflareDurableObjectAlarms(ids: DurableObjectId[]): Promise<void>;
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
      const storage = mf.getPluginStorage("DurableObjectsPlugin");
      const state = await plugin.getObject(storage, id);
      return state.storage;
    },
    getMiniflareFetchMock() {
      return fetchMock;
    },
    async flushMiniflareDurableObjectAlarms(ids?: DurableObjectId[]) {
      const plugin = (await mf.getPlugins()).DurableObjectsPlugin;
      const storage = mf.getPluginStorage("DurableObjectsPlugin");
      return plugin.flushAlarms(storage, ids);
    },
  };
}
