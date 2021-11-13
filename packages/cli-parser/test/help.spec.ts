import { buildHelp, wrapLines } from "@miniflare/cli-parser";
import { CorePlugin } from "@miniflare/core";
import { TestPlugin } from "@miniflare/shared-test";
import test from "ava";

const plugins = { CorePlugin, TestPlugin };

test("wrapLines: wraps long lines", (t) => {
  // Check with single line text that is the max length
  let lines = wrapLines("Short text", 10);
  t.deepEqual(lines, ["Short text"]);

  // Check with long text
  lines = wrapLines("I'm a long line with lots of long text", 10);
  t.deepEqual(lines, ["I'm a long", "line with", "lots of", "long text"]);

  // Check with long text where the last line is the max length
  lines = wrapLines("01234 56789", 5);
  t.deepEqual(lines, ["01234", "56789"]);

  // Check aborts if wrapping on spaces is impossible
  lines = wrapLines("01234 5678901234", 5);
  t.deepEqual(lines, ["01234", "5678901234"]);
});

test("buildHelp: generates correctly formatted help text", (t) => {
  const help = buildHelp(plugins, "test-exec", 80);
  t.is(
    help,
    `Usage: test-exec [script] [options]

Core Options:
 -h, --help                  Show help                                 [boolean]
 -v, --version               Show version number                       [boolean]
     --root                  Path to resolve default config files       [string]
                             relative to
 -c, --wrangler-config       Path to wrangler.toml                      [string]
     --wrangler-env          Environment in wrangler.toml to use        [string]
     --package               Path to package.json                       [string]
 -m, --modules               Enable modules                            [boolean]
     --modules-rule          Modules import rule               [array:TYPE=GLOB]
     --compat-date           Opt into backwards-incompatible changes    [string]
                             from
     --compat-flag           Control specific backwards-incompatible     [array]
                             changes
 -u, --upstream              URL of upstream origin                     [string]
 -w, --watch                 Watch files for changes                   [boolean]
 -d, --debug                 Enable debug logging                      [boolean]
 -V, --verbose               Enable verbose logging                    [boolean]
     --(no-)update-check     Enable update checker (enabled by         [boolean]
                             default)

Test Options:
 -b, --boolean-option        Boolean option                            [boolean]
 -n, --num-option            Number option                              [number]
 -s, --string-option                                                    [string]
     --boolean-string-option Boolean/string option              [boolean/string]
     --array-option                                                      [array]
 -o, --object-option                                           [array:KEY=VALUE]
     --array-object-option                                     [array:KEY=THING]`
  );
});
