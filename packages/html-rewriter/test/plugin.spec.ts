import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { NoOpLog } from "@miniflare/shared-test";
import test from "ava";

test("HTMLRewriterPlugin: setup: includes HTMLRewriter in globals", (t) => {
  const plugin = new HTMLRewriterPlugin(new NoOpLog());
  const result = plugin.setup();
  t.is(result.globals?.HTMLRewriter, HTMLRewriter);
});
