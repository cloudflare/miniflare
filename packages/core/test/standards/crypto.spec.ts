import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import { DOMException, DigestStream, createCrypto } from "@miniflare/core";
import { utf8Encode } from "@miniflare/shared-test";
import test, { Macro } from "ava";

const crypto = createCrypto();

const digestStreamMacro: Macro<[webcrypto.AlgorithmIdentifier]> = async (
  t,
  algorithm
) => {
  const stream = new DigestStream(algorithm);
  const writer = stream.getWriter();
  await writer.write(utf8Encode("a"));
  await writer.write(utf8Encode("bb"));
  await writer.write(utf8Encode("ccc"));
  await writer.close();
  const digest = await stream.digest;

  const expected = await crypto.subtle.digest(algorithm, utf8Encode("abbccc"));

  t.deepEqual(digest, expected);
};
digestStreamMacro.title = (providedTitle, algorithm) =>
  `DigestStream: computes ${JSON.stringify(algorithm)} digest`;
test(digestStreamMacro, "SHA-1");
test(digestStreamMacro, "Sha-256");
test(digestStreamMacro, "sha-384");
test(digestStreamMacro, "SHA-512");
test(digestStreamMacro, "mD5");
test(digestStreamMacro, { name: "ShA-1" });

test("DigestStream: throws on unsupported algorithm", (t) => {
  // Note md5 IS supported by Node's createHash
  t.throws(() => new DigestStream("md4"), {
    instanceOf: DOMException,
    name: "NotSupportedError",
    message: "Unrecognized name.",
  });
});

test("DigestStream: throws on string chunks", async (t) => {
  const stream = new DigestStream("sha-1");
  const writer = stream.getWriter();
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(async () => writer.write("a"), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received a string on its writable side. " +
      "If you wish to write a string, you'll probably want to " +
      "explicitly UTF-8-encode it with TextEncoder.",
  });
});
test("DigestStream: throws on non-ArrayBuffer/ArrayBufferView chunks", async (t) => {
  const stream = new DigestStream("sha-1");
  const writer = stream.getWriter();
  // @ts-expect-error intentionally testing incorrect types
  await t.throwsAsync(async () => writer.write(42), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received an object of non-ArrayBuffer/ArrayBufferView " +
      "type on its writable side.",
  });
});

test("crypto: provides DigestStream", (t) => {
  t.is(crypto.DigestStream, DigestStream);
});

// Check digest function modified to add MD5 support
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

// Check generateKey, importKey, sing, verify functions modified to add
// NODE-ED25519 support
test("crypto: generateKey/exportKey: supports NODE-ED25519 algorithm", async (t) => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
    true,
    ["sign", "verify"]
  );
  t.is(keyPair.publicKey.algorithm.name, "Ed25519");
  t.is(keyPair.privateKey.algorithm.name, "Ed25519");
  const exported = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  t.is(exported.byteLength, 32);
});
test("crypto: generateKey/exportKey: supports other algorithms", async (t) => {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  t.is(key.algorithm.name, "AES-GCM");
  const exported = await crypto.subtle.exportKey("raw", key);
  t.is(exported.byteLength, 32);
});

test("crypto: importKey/exportKey: supports NODE-ED25519 public keys", async (t) => {
  const keyData =
    "953e73cb91a2494a33cd7180f05d5bbe6b5ca43cc66eb93ca38c6fc83cb18f29";
  const publicKey = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyData, "hex"),
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
    true,
    ["verify"]
  );
  t.is(publicKey.algorithm.name, "Ed25519");
  const exported = await crypto.subtle.exportKey("raw", publicKey);
  t.is(Buffer.from(exported).toString("hex"), keyData);
});
test("crypto: importKey: fails for NODE-ED25519 private keys", async (t) => {
  const keyData =
    "f0d3c325a99ef50181faa238e07224ec9fee292e7ebf6585560bab64654ec6209c6afa31187898a43f7ab18c3552c2cd349e912c16c803a2a6ccbd546896fe8e";
  await t.throwsAsync(
    crypto.subtle.importKey(
      "raw",
      Buffer.from(keyData, "hex"),
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["sign"]
    )
  );
});
test("crypto: importKey/exportKey: supports other algorithms", async (t) => {
  const keyData =
    "464d832870721bcf28649192bec41bd1fd5b32702d6168f21b8585fb566a4be7";
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyData, "hex"),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  t.is(key.algorithm.name, "AES-GCM");
  const exported = await crypto.subtle.exportKey("raw", key);
  t.is(Buffer.from(exported).toString("hex"), keyData);
});
test("crypto: sign/verify: supports NODE-ED25519 algorithm", async (t) => {
  const algorithm: webcrypto.EcKeyAlgorithm = {
    name: "NODE-ED25519",
    namedCurve: "NODE-ED25519",
  };
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    algorithm,
    false,
    ["sign", "verify"]
  );
  const data = utf8Encode("data");
  const signature = await crypto.subtle.sign(algorithm, privateKey, data);
  t.is(signature.byteLength, 64);
  t.true(await crypto.subtle.verify(algorithm, publicKey, signature, data));
});
test("crypto: sign/verify: supports other algorithm", async (t) => {
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const data = utf8Encode("data");
  const signature = await crypto.subtle.sign("HMAC", key, data);
  t.is(signature.byteLength, 32);
  t.true(await crypto.subtle.verify("HMAC", key, signature, data));
});

test("crypto: timingSafeEqual equals", (t) => {
  const array1 = new Uint8Array(12);
  array1.fill(0, 0);
  const array2 = new Uint8Array(12);
  array2.fill(0, 0);
  t.true(crypto.subtle.timingSafeEqual(array1, array2));
});
test("crypto: timingSafeEqual not equals", (t) => {
  const array1 = new Uint8Array(12);
  array1.fill(0, 0);
  const array2 = new Uint8Array(12);
  array2.fill(0, 0);
  array2[7] = 1;
  t.false(crypto.subtle.timingSafeEqual(array1, array2));
});

// Checking other functions aren't broken by proxy...

test("crypto: gets random values", (t) => {
  const array = new Uint8Array(8);
  t.deepEqual(array, new Uint8Array(8));
  t.is(crypto.getRandomValues(array), array);
  t.notDeepEqual(array, new Uint8Array(8));
});

test("crypto: generates random UUID", (t) => {
  t.is(crypto.randomUUID().length, 36);
});
