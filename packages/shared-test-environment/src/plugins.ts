import { CachePlugin } from "@miniflare/cache";
import { BindingsPlugin, CorePlugin } from "@miniflare/core";
import { D1Plugin } from "@miniflare/d1";
import { DurableObjectsPlugin } from "@miniflare/durable-objects";
import { HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { KVPlugin } from "@miniflare/kv";
import { QueuesPlugin } from "@miniflare/queues";
import { R2Plugin } from "@miniflare/r2";
import { SitesPlugin } from "@miniflare/sites";
import { WebSocketPlugin } from "@miniflare/web-sockets";

// MiniflareCore will ensure CorePlugin is first and BindingsPlugin is last,
// so help it out by doing it ourselves so it doesn't have to. BuildPlugin
// is intentionally omitted as the worker should only be built once per test
// run, as opposed to once per test suite. The user is responsible for this.
export const PLUGINS = {
  CorePlugin,
  KVPlugin,
  D1Plugin,
  R2Plugin,
  DurableObjectsPlugin,
  CachePlugin,
  SitesPlugin,
  QueuesPlugin,
  HTMLRewriterPlugin,
  WebSocketPlugin,
  BindingsPlugin,
};
