import { Response } from "@miniflare/core";
import { HTMLRewriter, HTMLRewriterPlugin } from "@miniflare/html-rewriter";
import { QueueBroker } from "@miniflare/queues";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
} from "@miniflare/shared";
import { unusable } from "@miniflare/shared-test";
import test from "ava";
import type { ElementHandlers } from "html-rewriter-wasm";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: unusable(),
};

test("HTMLRewriterPlugin: setup: includes HTMLRewriter in globals", (t) => {
  const plugin = new HTMLRewriterPlugin(ctx);
  const result = plugin.setup();
  t.is(result.globals?.HTMLRewriter, HTMLRewriter);
});

test("HTMLRewriterPlugin: setup: treats esi tags as void only if compatibility flag enabled", async (t) => {
  const handlers: ElementHandlers = {
    element(element) {
      element.replace("replacement");
    },
  };
  const input = '<span><esi:include src="a" /> text<span>';

  // Check with flag disabled
  let plugin = new HTMLRewriterPlugin(ctx);
  let result = plugin.setup();
  let impl: typeof HTMLRewriter = result.globals?.HTMLRewriter;
  let res = new impl()
    .on("esi\\:include", handlers)
    .transform(new Response(input));
  t.is(await res.text(), "<span>replacement");

  // Check with flag enabled
  const compat = new Compatibility(undefined, [
    "html_rewriter_treats_esi_include_as_void_tag",
  ]);
  plugin = new HTMLRewriterPlugin({ ...ctx, compat });
  result = plugin.setup();
  impl = result.globals?.HTMLRewriter;
  res = new impl().on("esi\\:include", handlers).transform(new Response(input));
  t.is(await res.text(), "<span>replacement text<span>");
});
