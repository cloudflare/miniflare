import { CorePlugin, MiniflareCore } from "@miniflare/core";
import { VMScriptRunner } from "@miniflare/runner-vm";
import { Options, PluginSignatures } from "@miniflare/shared";
import { TestLog } from "./log";
import { MemoryStorageFactory } from "./storage";

const scriptRunner = new VMScriptRunner();

export function useMiniflare<Plugins extends PluginSignatures>(
  plugins: Plugins,
  options: Options<{ CorePlugin: typeof CorePlugin } & Plugins>,
  log = new TestLog()
): MiniflareCore<{ CorePlugin: typeof CorePlugin } & Plugins> {
  return new MiniflareCore(
    { CorePlugin, ...plugins },
    {
      log,
      storageFactory: new MemoryStorageFactory(),
      scriptRunner,
    },
    options
  );
}
