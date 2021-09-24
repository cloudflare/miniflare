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
import { Log, LogLevel, Options } from "@miniflare/shared";
import { SitesPlugin } from "@miniflare/sites";
import { WebSocketPlugin } from "@miniflare/web-sockets";
import { VariedStorageFactory } from "./storage";

export const PLUGINS = {
  // Core
  CorePlugin,
  HTTPPlugin,
  SchedulerPlugin,
  BuildPlugin,
  BindingsPlugin,

  // Storage
  KVPlugin,
  DurableObjectsPlugin,
  CachePlugin,
  SitesPlugin,

  // No options
  HTMLRewriterPlugin,
  WebSocketPlugin,
};

export type Plugins = typeof PLUGINS;

const kCore = Symbol("kCore");

export class Miniflare extends MiniflareCore<Plugins> {
  private [kCore]: MiniflareCore<Plugins>;

  constructor(options?: Options<Plugins>) {
    const logLevel = options?.verbose
      ? LogLevel.VERBOSE
      : options?.debug
      ? LogLevel.DEBUG
      : LogLevel.INFO;
    super(
      PLUGINS,
      {
        log: new Log(logLevel),
        storageFactory: new VariedStorageFactory(),
        scriptRunner: new VMScriptRunner(),
        scriptRequired: true,
      },
      options
    );
  }

  async getKVNamespace(namespace: string): Promise<KVNamespace> {
    const plugin = (await this[kCore].getPlugins()).KVPlugin;
    const storage = this[kCore].getPluginStorage("KVPlugin");
    return plugin.getNamespace(storage, namespace);
  }

  async getDurableObjectNamespace(
    objectName: string
  ): Promise<DurableObjectNamespace> {
    const plugin = (await this[kCore].getPlugins()).DurableObjectsPlugin;
    const storage = this[kCore].getPluginStorage("DurableObjectsPlugin");
    return plugin.getNamespace(storage, objectName);
  }

  async getDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage> {
    const plugin = (await this[kCore].getPlugins()).DurableObjectsPlugin;
    const storage = this[kCore].getPluginStorage("DurableObjectsPlugin");
    const internals = await plugin.getObject(storage, id);
    return internals.state.storage;
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
