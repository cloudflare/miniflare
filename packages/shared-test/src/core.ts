import {
  CorePlugin,
  MiniflareCore,
  MiniflareCoreOptions,
  Request,
  Response,
} from "@miniflare/core";
import { QueueBroker } from "@miniflare/queues";
import { VMScriptRunner } from "@miniflare/runner-vm";
import {
  Awaitable,
  Context,
  Log,
  NoOpLog,
  Options,
  PluginSignatures,
  StorageFactory,
} from "@miniflare/shared";
import { Response as BaseResponse } from "undici";
import { MemoryStorageFactory } from "./storage";
import { triggerPromise } from "./sync";

const scriptRunner = new VMScriptRunner();

export function useMiniflare<Plugins extends PluginSignatures>(
  extraPlugins: Plugins,
  options: MiniflareCoreOptions<{ CorePlugin: typeof CorePlugin } & Plugins>,
  log: Log = new NoOpLog(),
  storageFactory: StorageFactory = new MemoryStorageFactory(),
  queueBroker: QueueBroker = new QueueBroker()
): MiniflareCore<{ CorePlugin: typeof CorePlugin } & Plugins> {
  return new MiniflareCore(
    { CorePlugin, ...extraPlugins },
    { log, storageFactory, scriptRunner, queueBroker },
    options
  );
}

export function useMiniflareWithHandler<Plugins extends PluginSignatures>(
  extraPlugins: Plugins,
  options: Options<{ CorePlugin: typeof CorePlugin } & Plugins>,
  handler: (
    globals: Context,
    req: Request
  ) => Awaitable<Response | BaseResponse>,
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

export function waitForReload(mf: MiniflareCore<any>): Promise<unknown> {
  const [reloadTrigger, reloadPromise] = triggerPromise<unknown>();
  mf.addEventListener("reload", reloadTrigger, { once: true });
  return reloadPromise;
}
