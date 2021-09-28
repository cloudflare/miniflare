import { DOMException } from "@miniflare/core";
import test from "ava";

test('DOMException: name defaults to "Error"', (t) => {
  t.is(new DOMException("msg").name, "Error");
});
test("DOMException: code: returns correct code for name", (t) => {
  t.is(new DOMException("msg", "SyntaxError").code, DOMException.SYNTAX_ERR);
});
test("DOMException: code: returns 0 for unknown name", (t) => {
  t.is(new DOMException("msg", "UnknownError").code, 0);
});
