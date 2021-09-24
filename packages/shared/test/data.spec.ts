import {
  base64Decode,
  base64Encode,
  nonCircularClone,
  sanitisePath,
} from "@miniflare/shared";
import test from "ava";

test("nonCircularClone: creates copy of data", (t) => {
  const original = { a: 1, b: { c: "2" } };
  const clone = nonCircularClone(original);
  t.not(original, clone);
  t.not(original.b, clone.b);
  t.deepEqual(original, clone);
});

test("base64Encode: encodes base64 string", (t) => {
  t.is(base64Encode("test ✅"), "dGVzdCDinIU=");
});
test("base64Decode: decodes base64 string", (t) => {
  t.is(base64Decode("dGVzdCDinIU="), "test ✅");
});

test("sanitisePath: doesn't change safe paths", (t) => {
  t.is(sanitisePath("test file.txt"), "test file.txt");
  t.is(sanitisePath("tést filé.txt"), "tést filé.txt");
});
test("sanitisePath: sanitises namespace separators", (t) => {
  t.is(sanitisePath("a/b\\c:d|e"), "a/b/c/d/e");
});
test("sanitisePath: sanitises relative paths", (t) => {
  t.is(sanitisePath("."), "_");
  t.is(sanitisePath(".."), "__");
  t.is(sanitisePath("./"), "__");
  t.is(sanitisePath("../"), "___");
  t.is(sanitisePath("/.."), "/__");
  t.is(sanitisePath("/../"), "/___");
  t.is(sanitisePath("..\\./.../..\\..../.a./."), "__/_/___/__/____/.a./_");
  t.is(sanitisePath("dir/../test.txt"), "dir/__/test.txt");
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
test("sanitisePath: sanitises trailing characters", (t) => {
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
