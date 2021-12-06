import { TextEncoder } from "util";
import { crypto } from "@miniflare/core";
import { utf8Encode } from "@miniflare/shared-test";
import test, { Macro } from "ava";

const md5Macro: Macro<[BufferSource]> = async (t, data) => {
  const digest = await crypto.subtle.digest("md5", data);
  t.is(Buffer.from(digest).toString("hex"), "098f6bcd4621d373cade4e832627b4f6");
};
md5Macro.title = (providedTitle) =>
  `crypto: computes md5 digest of ${providedTitle}`;
test("Uint8Array", md5Macro, utf8Encode("test"));
test("DataView", md5Macro, new DataView(utf8Encode("test").buffer));
test("ArrayBuffer", md5Macro, utf8Encode("test").buffer);

test("crypto: computes other digest", async (t) => {
  const digest = await crypto.subtle.digest(
    "sha-1",
    new TextEncoder().encode("test")
  );
  t.is(
    Buffer.from(digest).toString("hex"),
    "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
  );
});

// Checking other functions aren't broken by proxy...

test("crypto: gets random values", (t) => {
  const array = new Uint8Array(8);
  t.deepEqual(array, new Uint8Array(8));
  t.is(crypto.getRandomValues(array), array);
  t.notDeepEqual(array, new Uint8Array(8));
});

test("crypto: generates aes key", async (t) => {
  const key = await crypto.subtle.generateKey(
    { name: "aes-gcm", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", key);
  t.is(exported.byteLength, 32);
});
