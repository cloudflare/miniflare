import { Log, Plugin, SetupResult } from "@miniflare/shared";
import { HTMLRewriter } from "./rewriter";

export class HTMLRewriterPlugin extends Plugin {
  constructor(log: Log) {
    super(log);
  }

  setup(): SetupResult {
    return { globals: { HTMLRewriter } };
  }
}
