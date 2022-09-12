import os from "os";
import path from "path";
import repl from "repl";
import vm from "vm";
import { CorePluginSignatures, MiniflareCore } from "@miniflare/core";

const defaultReplHistory = path.join(os.homedir(), ".mf_repl_history");

interface MutableContextREPLServer extends repl.REPLServer {
  context: vm.Context;
}

export async function startREPL<Plugins extends CorePluginSignatures>(
  mf: MiniflareCore<Plugins>
): Promise<void> {
  // Get options from environment variables:
  // https://nodejs.org/api/repl.html#environment-variable-options
  const historyPath = process.env.MINIFLARE_REPL_HISTORY ?? defaultReplHistory;
  // https://github.com/nodejs/node/blob/5fad0b93667ffc6e4def52996b9529ac99b26319/lib/internal/repl.js#L44
  let historySize = Number(process.env.MINIFLARE_REPL_HISTORY_SIZE);
  if (isNaN(historySize) || historySize <= 0) historySize = 1000;
  // https://github.com/nodejs/node/blob/5fad0b93667ffc6e4def52996b9529ac99b26319/lib/internal/repl.js#L33
  const replMode =
    process.env.MINIFLARE_REPL_MODE?.toLowerCase().trim() === "strict"
      ? repl.REPL_MODE_STRICT
      : repl.REPL_MODE_SLOPPY;

  // Get global scope and bindings
  const globalScope = await mf.getGlobalScope();
  const bindings = await mf.getBindings();

  // Create custom context
  const context = vm.createContext(globalScope, {
    codeGeneration: { strings: false, wasm: false },
  });
  // Assign `env` as a global variable so people can use module worker's syntax
  context.env = bindings;

  // Start the REPL with the custom context
  const replServer = repl.start({ replMode, historySize } as repl.ReplOptions);
  (replServer as MutableContextREPLServer).context = context;

  // Setup history if enabled
  if (historyPath !== "") {
    replServer.setupHistory(historyPath, (err) => {
      if (err) mf.log.error(err);
    });
  }
}
