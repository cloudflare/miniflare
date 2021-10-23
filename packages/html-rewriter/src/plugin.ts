import { Compatibility, Log, Plugin, SetupResult } from "@miniflare/shared";
import { HTMLRewriter } from "./rewriter";

export class HTMLRewriterPlugin extends Plugin {
  constructor(log: Log, compat: Compatibility) {
    super(log, compat);
  }

  setup(): SetupResult {
    return { globals: { HTMLRewriter } };
  }
}
