import { DOMException, atob, btoa } from "@miniflare/core";
import test from "ava";

test("btoa: base64 encodes data", (t) => {
  t.is(btoa("test"), "dGVzdA==");
});
test("btoa: throws on invalid character", (t) => {
  t.throws(() => btoa("✅"), {
    instanceOf: DOMException,
    name: "InvalidCharacterError",
    message: "Invalid character",
  });
});

test("atob: base64 encodes data", (t) => {
  t.is(atob("dGVzdA=="), "test");
});
test("atob: removes ASCII whitespace from input", (t) => {
  t.is(atob(" dG\fV\tz\r\nd  A== "), "test");
});
test("atob: throws on invalid character", (t) => {
  t.throws(() => atob("base64!"), {
    instanceOf: DOMException,
    name: "InvalidCharacterError",
    message: "Invalid character",
  });
});
