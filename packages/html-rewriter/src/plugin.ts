import { Plugin, PluginContext, SetupResult } from "@miniflare/shared";
import { HTMLRewriter, withEnableEsiTags } from "./rewriter";

const ESIHTMLRewriter = new Proxy(HTMLRewriter, {
  construct(target, args, newTarget) {
    const value = Reflect.construct(target, args, newTarget);
    return withEnableEsiTags(value);
  },
});

export class HTMLRewriterPlugin extends Plugin {
  constructor(ctx: PluginContext) {
    super(ctx);
  }

  setup(): SetupResult {
    const enableEsiFlags = this.ctx.compat.isEnabled(
      "html_rewriter_treats_esi_include_as_void_tag"
    );
    const impl = enableEsiFlags ? ESIHTMLRewriter : HTMLRewriter;
    return { globals: { HTMLRewriter: impl } };
  }
}
