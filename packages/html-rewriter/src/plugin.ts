import { Plugin, PluginContext, SetupResult } from "@miniflare/shared";
import { HTMLRewriter } from "./rewriter";

export class HTMLRewriterPlugin extends Plugin {
  constructor(ctx: PluginContext) {
    super(ctx);
  }

  setup(): SetupResult {
    return { globals: { HTMLRewriter } };
  }
}
