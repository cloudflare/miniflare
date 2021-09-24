import { buildHelp } from "@miniflare/cli";
import { CorePlugin } from "@miniflare/core";
import test from "ava";
import { TestPlugin } from "./helpers";

const plugins = { CorePlugin, TestPlugin };

test("buildHelp: generates correctly formatted help text", (t) => {
  const help = buildHelp(plugins, "test-exec");
  t.is(
    help,
    `Usage: test-exec [script] [options]

Core Options:
  -h, --help                   Show help                            [boolean]
  -v, --version                Show version number                  [boolean]
  -c, --wrangler-config        Path to wrangler.toml                [string]
      --wrangler-env           Environment in wrangler.toml to use  [string]
      --package                Path to package.json                 [string]
  -m, --modules                Enable modules                       [boolean]
      --modules-rule           Modules import rule                  [array:TYPE=GLOB]
  -u, --upstream               URL of upstream origin               [string]
  -w, --watch                  Watch files for changes              [boolean]
  -d, --debug                  Enable debug logging                 [boolean]
      --verbose                Enable verbose logging               [boolean]

Test Options:
  -b, --boolean-option         Boolean option                       [boolean]
  -n, --num-option             Number option                        [number]
  -s, --string-option                                               [string]
      --boolean-string-option  Boolean/string option                [boolean/string]
      --array-option                                                [array]
  -o, --object-option                                               [array:KEY=VALUE]
      --array-object-option                                         [array:KEY=THING]`
  );
});
