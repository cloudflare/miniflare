import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { Compatibility } from "@miniflare/shared";
import { NoOpLog } from "@miniflare/shared-test";
import test from "ava";

test("HTMLRewriterPlugin: setup: includes HTMLRewriter in globals", (t) => {
  const plugin = new HTMLRewriterPlugin(new NoOpLog(), new Compatibility());
  const result = plugin.setup();
  t.is(result.globals?.HTMLRewriter, HTMLRewriter);
});
