import path from "path";
import { TextDecoder } from "util";
import {
  addAll,
  arrayCompare,
  base64Decode,
  base64Encode,
  globsToMatcher,
  kebabCase,
  lexicographicCompare,
  nonCircularClone,
  resolveStoragePersist,
  sanitisePath,
  spaceCase,
  titleCase,
  viewToArray,
  viewToBuffer,
} from "@miniflare/shared";
import { useTmp } from "@miniflare/shared-test";
import test from "ava";

test("arrayCompare: compares arrays", (t) => {
  // Check with numeric values
  t.is(arrayCompare([], []), 0);
  t.is(arrayCompare([1, 2, 3], [1, 2, 3]), 0);
  t.true(arrayCompare([], [1]) < 0);
  t.true(arrayCompare([1], []) > 0);
  t.true(arrayCompare([1, 2, 3], [1, 2, 4]) < 0);
  t.true(arrayCompare([1, 2, 4], [1, 2, 3]) > 0);
  t.true(arrayCompare([1, 2], [1, 2, 3]) < 0);
  t.true(arrayCompare([1, 2, 3], [1, 2]) > 0);

  // Check with non-numeric values
  t.true(arrayCompare(["a", "b", "c"], ["a", "b", "d"]) < 0);
  t.true(arrayCompare(["a", "b", "d"], ["a", "b", "c"]) > 0);
});

test("lexicographicCompare: compares lexicographically", (t) => {
  t.is(lexicographicCompare("a", "b"), -1);
  t.is(lexicographicCompare("a", "a"), 0);
  t.is(lexicographicCompare("b", "a"), 1);
  t.is(lexicographicCompare("!", ", "), -1);

  // https://github.com/cloudflare/miniflare/issues/380
  t.is(lexicographicCompare("Z", "\uFF3A"), -1);
  t.is(lexicographicCompare("\uFF3A", "\u{1D655}"), -1);
  t.is(lexicographicCompare("\u{1D655}", "Z"), 1);
});

test("nonCircularClone: creates copy of data", (t) => {
  const original = { a: 1, b: { c: "2" } };
  const clone = nonCircularClone(original);
  t.not(original, clone);
  t.not(original.b, clone.b);
  t.deepEqual(original, clone);
});

test("addAll: adds all elements to set", (t) => {
  const set = new Set<string>();
  addAll(set, ["a", "b", "c"]);
  t.true(set.has("a"));
  t.true(set.has("b"));
  t.true(set.has("c"));
});

test("viewToArray: converts ArrayBufferView to Uint8Array", (t) => {
  const array = viewToArray(Buffer.from("test"));
  t.is(new TextDecoder().decode(array), "test");
});
test("viewToBuffer: converts ArrayBufferView to ArrayBuffer", (t) => {
  const buffer = viewToBuffer(Buffer.from("test"));
  t.is(new TextDecoder().decode(buffer), "test");
});

test("base64Encode: encodes base64 string", (t) => {
  t.is(base64Encode("test ✅"), "dGVzdCDinIU=");
});
test("base64Decode: decodes base64 string", (t) => {
  t.is(base64Decode("dGVzdCDinIU="), "test ✅");
});

test("globsToMatcher: converts globs to string matcher", (t) => {
  const globs = ["*.txt", "src/**/*.js", "!src/bad.js"];
  const matcher = globsToMatcher(globs);

  // Check `*.txt`
  t.true(matcher.test("test.txt"));
  t.true(matcher.test("dist/test.txt"));

  // Check `src/**/*.js`
  t.true(matcher.test("src/index.js"));
  t.true(matcher.test("src/lib/add.js"));
  t.false(matcher.test("src/image.jpg"));

  // Check `!src/bad.js`
  t.false(matcher.test("src/bad.js"));

  // Check absolute paths (`ModuleLinker` will `path.resolve` to absolute paths)
  // (see https://github.com/cloudflare/miniflare/issues/244)
  t.true(matcher.test("/one/two/three.txt"));
  t.true(matcher.test(path.join(process.cwd(), "src/index.js")));

  // Check debug output
  t.is(matcher.toString(), globs.join(", "));
});
test("globsToMatcher: returns matcher that matches nothing on undefined globs", (t) => {
  const matcher = globsToMatcher();
  t.false(matcher.test("test.txt"));
  t.is(matcher.toString(), "");
});

test("kebabCase: converts string from camelCase to kebab-case", (t) => {
  t.is(kebabCase("optionOneName"), "option-one-name");
});
test("spaceCase: converts string from PascalCase or camelCase to space case", (t) => {
  t.is(spaceCase("HTTPPlugin"), "HTTP Plugin");
  t.is(spaceCase("optionOneName"), "option One Name");
});
test("titleCase: converts string from PascalCase or camelCase to Title Case", (t) => {
  t.is(titleCase("HTTPPlugin"), "HTTP Plugin");
  t.is(titleCase("optionOneName"), "Option One Name");
});

test("resolveStoragePersist: resolves file system paths relative to root", async (t) => {
  const tmp = await useTmp(t);
  const tmp2 = await useTmp(t);
  t.is(resolveStoragePersist(tmp, "data"), path.resolve(tmp, "data"));
  t.is(resolveStoragePersist(tmp, tmp2), tmp2);
});
test("resolveStoragePersist: leaves other paths untouched", (t) => {
  t.is(resolveStoragePersist("/root"), undefined);
  t.is(resolveStoragePersist("/root", false), false);
  t.is(resolveStoragePersist("/root", true), true);
  t.is(
    resolveStoragePersist("/root", "redis://localhost:6379"),
    "redis://localhost:6379"
  );
});

test("sanitisePath: doesn't change safe paths", (t) => {
  t.is(sanitisePath("test file.txt"), "test file.txt");
  t.is(sanitisePath("tést filé.txt"), "tést filé.txt");
});
test("sanitisePath: sanitises namespace separators", (t) => {
  const s = path.sep;
  t.is(sanitisePath("a/b\\c:d|e"), `a${s}b${s}c${s}d${s}e`);
});
test("sanitisePath: sanitises relative paths", (t) => {
  const s = path.sep;
  t.is(sanitisePath("."), "_");
  t.is(sanitisePath(".."), "__");
  t.is(sanitisePath("./"), "__");
  t.is(sanitisePath("../"), "___");
  t.is(sanitisePath("./.."), `_${s}__`);
  t.is(sanitisePath("./../"), `_${s}___`);
  t.is(
    sanitisePath("..\\./.../..\\..../.a./."),
    `__${s}_${s}___${s}__${s}____${s}.a.${s}_`
  );
  t.is(sanitisePath("dir/../test.txt"), `dir${s}__${s}test.txt`);
});
test("sanitisePath: sanitises illegal characters", (t) => {
  t.is(sanitisePath("?.text"), "_.text");
  t.is(sanitisePath("h<ll*.txt"), "h_ll_.txt");
  t.is(sanitisePath(">\"'^new\nline"), "____new_line");
});
test("sanitisePath: sanitises reserved filenames", (t) => {
  t.is(sanitisePath("CON"), "_");
  t.is(sanitisePath("com4"), "_");
  t.is(sanitisePath("PRN."), "_");
  t.is(sanitisePath("aux.txt"), "_");
  t.is(sanitisePath("LpT9.text"), "_");
  t.is(sanitisePath("LPT10"), "LPT10");
});
test("sanitisePath: sanitises leading and trailing characters", (t) => {
  t.is(sanitisePath(" /test"), "__test");
  t.is(sanitisePath("hello   "), "hello___");
  t.is(sanitisePath("file/ /"), "file___");
});
test("sanitisePath: truncates to 255 characters", (t) => {
  const base = "".padStart(254, "x");
  t.is(base.length, 254);
  t.is(sanitisePath(base), base);
  t.is(sanitisePath(base + "x"), base + "x");
  t.is(sanitisePath(base + "xx"), base + "x");
});
