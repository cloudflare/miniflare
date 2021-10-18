import { CorePlugin, MiniflareCore, Request, Response } from "@miniflare/core";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  Context,
  Log,
  MaybePromise,
  Options,
  PluginSignatures,
} from "@miniflare/shared";
import { NoOpLog } from "./log";
import { MemoryStorageFactory } from "./storage";

const scriptRunner = new VMScriptRunner();

export function useMiniflare<Plugins extends PluginSignatures>(
  extraPlugins: Plugins,
  options: Options<{ CorePlugin: typeof CorePlugin } & Plugins>,
  log: Log = new NoOpLog()
): MiniflareCore<{ CorePlugin: typeof CorePlugin } & Plugins> {
  return new MiniflareCore(
    { CorePlugin, ...extraPlugins },
    {
      log,
      storageFactory: new MemoryStorageFactory(),
      scriptRunner,
    },
    options
  );
}

export function useMiniflareWithHandler<Plugins extends PluginSignatures>(
  extraPlugins: Plugins,
  options: Options<{ CorePlugin: typeof CorePlugin } & Plugins>,
  handler: (globals: Context, req: Request) => MaybePromise<Response>,
  log: Log = new NoOpLog()
): MiniflareCore<{ CorePlugin: typeof CorePlugin } & Plugins> {
  return useMiniflare(
    extraPlugins,
    {
      // @ts-expect-error options is an object type
      ...options,
      script: `addEventListener("fetch", (e) => {
      e.respondWith((${handler.toString()})(globalThis, e.request));
    })`,
    },
    log
  );
}
