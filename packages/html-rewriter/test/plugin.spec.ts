import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { Compatibility, NoOpLog } from "@miniflare/shared";
import test from "ava";

test("HTMLRewriterPlugin: setup: includes HTMLRewriter in globals", (t) => {
  const plugin = new HTMLRewriterPlugin(new NoOpLog(), new Compatibility());
  const result = plugin.setup();
  t.is(result.globals?.HTMLRewriter, HTMLRewriter);
});
