import { TextEncoder } from "util";
import { TextDecoder } from "@miniflare/core";
import test, { ThrowsExpectation } from "ava";

const encoder = new TextEncoder();
const encoded = encoder.encode("test");

test("TextDecoder: only supports utf8 encoding", (t) => {
  // Check supported encodings
  t.is(new TextDecoder().decode(encoded), "test");
  t.is(new TextDecoder("utf-8").decode(encoded), "test");
  t.is(new TextDecoder("utf8").decode(encoded), "test");
  t.is(new TextDecoder("unicode-1-1-utf-8").decode(encoded), "test");

  const utf8Expectations: ThrowsExpectation = {
    instanceOf: RangeError,
    message: "TextDecoder only supports utf-8 encoding",
  };
  // Check case-sensitivity
  t.throws(() => new TextDecoder("UTF8"), utf8Expectations);
  // Check non-utf8 encoding supported by Node, but not Workers
  t.throws(() => new TextDecoder("utf-16le"), utf8Expectations);
  // Check non-utf8 encoding not supported by Node nor Workers
  t.throws(() => new TextDecoder("not-an-encoding"), utf8Expectations);
});
