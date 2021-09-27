import { CorePluginSignatures, MiniflareCore } from "@miniflare/core";
import { VMScriptRunner } from "@miniflare/runner-vm";
import { Options } from "@miniflare/shared";
import { TestLog } from "./log";
import { MemoryStorageFactory } from "./storage";

const scriptRunner = new VMScriptRunner();

export function useMiniflare<Plugins extends CorePluginSignatures>(
  plugins: Plugins,
  options: Options<Plugins>,
  log = new TestLog()
): MiniflareCore<Plugins> {
  return new MiniflareCore(
    plugins,
    {
      log,
      storageFactory: new MemoryStorageFactory(),
      scriptRunner,
    },
    options
  );
}
