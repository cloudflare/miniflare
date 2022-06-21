import repl from "repl";
import vm from "vm";
import { CorePluginSignatures, MiniflareCore } from "@miniflare/core";

interface MutableContextREPLServer extends repl.REPLServer {
  context: vm.Context;
}

export async function startREPL<Plugins extends CorePluginSignatures>(
  mf: MiniflareCore<Plugins>
): Promise<void> {
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
  (repl.start() as MutableContextREPLServer).context = context;
}
