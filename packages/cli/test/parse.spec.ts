import { ParseError, parseArgv } from "@miniflare/cli";
import { CorePlugin } from "@miniflare/core";
import test, { ThrowsExpectation } from "ava";
import { TestPlugin } from "./helpers";

const plugins = { CorePlugin, TestPlugin };

test("parseArgv: parses all option types", (t) => {
  const options = parseArgv(plugins, [
    "positional",
    "--watch",
    "--boolean-option",
    "--num-option",
    "42",
    "--string-option",
    "test",
    "--boolean-string-option",
    "I'm a boolean",
    "--array-option",
    "item1",
    "--array-option",
    "item2",
    "--array-option",
    "24",
    "--object-option",
    "key1=value1",
    "--object-option",
    "key2=value2",
    "--array-object-option",
    "key=value1",
    "--array-object-option",
    "key=value2",
  ]);
  t.deepEqual(options, {
    scriptPath: "positional",
    watch: true,
    booleanOption: true,
    numberOption: 42,
    stringOption: "test",
    booleanStringOption: "I'm a boolean",
    arrayOptions: ["item1", "item2", "24"],
    objectOptions: { key1: "value1", key2: "value2" },
    arrayObjectOption: [
      ["key", "value1"],
      ["key", "value2"],
    ],
  });
});
test("parseArgv: parses aliases", (t) => {
  const options = parseArgv(plugins, [
    "-wb",
    "-n",
    "42",
    "-s",
    "test",
    "-o",
    "key1=value1",
    "-o",
    "key2=value2",
  ]);
  t.deepEqual(options, {
    watch: true,
    booleanOption: true,
    numberOption: 42,
    stringOption: "test",
    objectOptions: { key1: "value1", key2: "value2" },
  });
});
test("parseArgv: parses positional between options", (t) => {
  const options = parseArgv(plugins, [
    "--boolean-option",
    "positional",
    "-n",
    "42",
  ]);
  t.deepEqual(options, {
    scriptPath: "positional",
    booleanOption: true,
    numberOption: 42,
  });
});
test("parseArgv: parses positional after --", (t) => {
  const options = parseArgv(plugins, ["--boolean-option", "--", "--help"]);
  t.deepEqual(options, {
    scriptPath: "--help",
    booleanOption: true,
  });
});
test("parseArgv: parses empty argv", (t) => {
  const options = parseArgv(plugins, []);
  t.deepEqual(options, {});
});
test("parseArgv: parses boolean/string", (t) => {
  let options = parseArgv(plugins, ["--boolean-string-option"]);
  t.deepEqual(options, { booleanStringOption: true });
  options = parseArgv(plugins, ["--boolean-string-option", "I'm a boolean"]);
  t.deepEqual(options, { booleanStringOption: "I'm a boolean" });
  options = parseArgv(plugins, ["--boolean-string-option", "42"]);
  t.deepEqual(options, { booleanStringOption: "42" });
});

test("parseArgv: throws on --help", (t) => {
  const expectation: ThrowsExpectation = {
    instanceOf: ParseError,
    code: "ERR_HELP",
  };
  t.throws(() => parseArgv(plugins, ["--help"]), expectation);
  t.throws(() => parseArgv(plugins, ["-h"]), expectation);
});
test("parseArgv: throws on --version", (t) => {
  const expectation: ThrowsExpectation = {
    instanceOf: ParseError,
    code: "ERR_VERSION",
    message: /^\d+\.\d+\.\d+$/,
  };
  t.throws(() => parseArgv(plugins, ["--version"]), expectation);
  t.throws(() => parseArgv(plugins, ["-v"]), expectation);
});

test("parseArgv: throws on unexpected option", (t) => {
  t.throws(() => parseArgv(plugins, ["--random"]), {
    instanceOf: ParseError,
    code: "ERR_OPTION",
    message: "Unexpected option: --random",
  });
});

const valueExpectation: ThrowsExpectation = {
  instanceOf: ParseError,
  code: "ERR_VALUE",
};
test("parseArgv: throws on invalid boolean", (t) => {
  t.throws(() => parseArgv(plugins, ["-b", "-b"]), {
    ...valueExpectation,
    message:
      "Unexpected value for --boolean-option: [true,true] (expected boolean)",
  });
});
test("parseArgv: throws on invalid number", (t) => {
  t.throws(() => parseArgv(plugins, ["-n", "not a number"]), {
    ...valueExpectation,
    message:
      'Unexpected value for --num-option: "not a number" (expected number)',
  });
  t.throws(() => parseArgv(plugins, ["-n", "-b"]), {
    ...valueExpectation,
    message: "Unexpected value for --num-option: true (expected number)",
  });
  t.throws(() => parseArgv(plugins, ["-n", "42", "-n", "43"]), {
    ...valueExpectation,
    message: "Unexpected value for --num-option: [42,43] (expected number)",
  });
});
test("parseArgv: throws on invalid string", (t) => {
  t.throws(() => parseArgv(plugins, ["-s", "a", "-s", "b"]), {
    ...valueExpectation,
    message:
      'Unexpected value for --string-option: ["a","b"] (expected string)',
  });
});
test("parseArgv: throws on invalid positional string", (t) => {
  t.throws(() => parseArgv(plugins, ["a", "b"]), {
    ...valueExpectation,
    message: 'Unexpected value for script: ["a","b"] (expected string)',
  });
});
test("parseArgv: throws on invalid boolean/string", (t) => {
  t.throws(
    () =>
      parseArgv(plugins, [
        "--boolean-string-option",
        "--boolean-string-option",
        "I'm a boolean",
      ]),
    {
      ...valueExpectation,
      message:
        'Unexpected value for --boolean-string-option: [true,"I\'m a boolean"] (expected boolean/string)',
    }
  );
});
test("parseArgv: throws on invalid object", (t) => {
  t.throws(() => parseArgv(plugins, ["-o", "key:value"]), {
    ...valueExpectation,
    message:
      'Unexpected value for --object-option: "key:value" (expected KEY=VALUE)',
  });
  t.throws(() => parseArgv(plugins, ["--array-object-option", "key:value"]), {
    ...valueExpectation,
    message:
      'Unexpected value for --array-object-option: "key:value" (expected KEY=THING)',
  });
});
