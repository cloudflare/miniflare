import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { Compatibility, NoOpLog } from "@miniflare/shared";
import test from "ava";

test("HTMLRewriterPlugin: setup: includes HTMLRewriter in globals", (t) => {
  const plugin = new HTMLRewriterPlugin({
    log: new NoOpLog(),
    compat: new Compatibility(),
    rootPath: process.cwd(),
  });
  const result = plugin.setup();
  t.is(result.globals?.HTMLRewriter, HTMLRewriter);
});
