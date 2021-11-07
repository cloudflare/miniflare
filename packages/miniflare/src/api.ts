import http from "http";
import https from "https";
import { CachePlugin } from "@miniflare/cache";
import {
  BindingsPlugin,
  BuildPlugin,
  CorePlugin,
  MiniflareCore,
} from "@miniflare/core";
import {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStorage,
  DurableObjectsPlugin,
} from "@miniflare/durable-objects";
import { HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { HTTPPlugin, createServer, startServer } from "@miniflare/http-server";
import { KVNamespace, KVPlugin } from "@miniflare/kv";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  Scheduler,
  SchedulerPlugin,
  startScheduler,
} from "@miniflare/scheduler";
import { Log, NoOpLog, Options } from "@miniflare/shared";
import { SitesPlugin } from "@miniflare/sites";
import { WebSocketPlugin } from "@miniflare/web-sockets";
import sourceMap from "source-map-support";
import { VariedStorageFactory } from "./storage";

// MiniflareCore will ensure CorePlugin is first and BindingsPlugin is last,
// so help it out by doing it ourselves so it doesn't have to
export const PLUGINS = {
  // Core
  CorePlugin,
  HTTPPlugin,
  SchedulerPlugin,
  BuildPlugin,

  // Storage
  KVPlugin,
  DurableObjectsPlugin,
  CachePlugin,
  SitesPlugin,

  // No options
  HTMLRewriterPlugin,
  WebSocketPlugin,

  BindingsPlugin,
};

export type Plugins = typeof PLUGINS;

export type MiniflareOptions = Omit<Options<Plugins>, "debug" | "verbose"> & {
  log?: Log;
  sourceMap?: boolean;
};

export class Miniflare extends MiniflareCore<Plugins> {
  #storageFactory: VariedStorageFactory;

  constructor(options?: MiniflareOptions) {
    if (options?.sourceMap) {
      // Node has the --enable-source-maps flag, but this doesn't work for VM scripts.
      // It also doesn't expose a way of flushing the source map cache, which we need
      // so previous versions of worker code don't end up in stack traces.
      sourceMap.install({ emptyCacheBetweenOperations: true });
    }

    const storageFactory = new VariedStorageFactory();
    super(
      PLUGINS,
      {
        log: options?.log ?? new NoOpLog(),
        storageFactory,
        scriptRunner: new VMScriptRunner(),
        scriptRequired: true,
      },
      options
    );
    this.#storageFactory = storageFactory;
  }

  async dispose(): Promise<void> {
    await super.dispose();
    await this.#storageFactory.dispose();
  }

  async getKVNamespace(namespace: string): Promise<KVNamespace> {
    const plugin = (await this.getPlugins()).KVPlugin;
    const storage = this.getPluginStorage("KVPlugin");
    return plugin.getNamespace(storage, namespace);
  }

  async getDurableObjectNamespace(
    objectName: string
  ): Promise<DurableObjectNamespace> {
    const plugin = (await this.getPlugins()).DurableObjectsPlugin;
    const storage = this.getPluginStorage("DurableObjectsPlugin");
    return plugin.getNamespace(storage, objectName);
  }

  async getDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage> {
    const plugin = (await this.getPlugins()).DurableObjectsPlugin;
    const storage = this.getPluginStorage("DurableObjectsPlugin");
    const state = await plugin.getObject(storage, id);
    return state.storage;
  }

  createServer(
    options?: http.ServerOptions & https.ServerOptions
  ): Promise<http.Server | https.Server> {
    return createServer(this, options);
  }

  startServer(
    options?: http.ServerOptions & https.ServerOptions
  ): Promise<http.Server | https.Server> {
    return startServer(this, options);
  }

  startScheduler(): Promise<Scheduler<Plugins>> {
    return startScheduler(this);
  }
}
