import { TextEncoder } from "util";
import { DOMException, DigestStream, createCrypto } from "@miniflare/core";
import { utf8Encode } from "@miniflare/shared-test";
import test, { Macro } from "ava";

const crypto = createCrypto();

const digestStreamMacro: Macro<[AlgorithmIdentifier]> = async (
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

test("crypto: generateKey supports NODE-ED25519 algorithm", async (t) => {
  const alg = {
    name: 'NODE-ED25519',
    namedCurve: 'NODE-ED25519',
  };
  await t.notThrowsAsync(async () => await crypto.subtle.generateKey(alg, false, ['sign']));
});

test("crypto: importKey supports NODE-ED25519 public keys", async (t) => {
  const alg = {
    name: 'NODE-ED25519',
    namedCurve: 'NODE-ED25519',
  };
  const publicKey = Buffer.from('953e73cb91a2494a33cd7180f05d5bbe6b5ca43cc66eb93ca38c6fc83cb18f29', 'hex')
  await t.notThrowsAsync(
    // @ts-expect-error importKey is missing from TS declaration for SubtleCrypto
    crypto.subtle.importKey('raw', publicKey, alg, true, ['verify'])
  );
});

test("crypto: importKey fails for NODE-ED25519 private keys", async (t) => {
  const alg = {
    name: 'NODE-ED25519',
    namedCurve: 'NODE-ED25519',
  };
  const publicKey = Buffer.from('f0d3c325a99ef50181faa238e07224ec9fee292e7ebf6585560bab64654ec6209c6afa31187898a43f7ab18c3552c2cd349e912c16c803a2a6ccbd546896fe8e', 'hex')
  await t.throwsAsync(
    // @ts-expect-error importKey is missing from TS declaration for SubtleCrypto
    crypto.subtle.importKey('raw', publicKey, alg, false, ['sign'])
  );
});

test("crypto: exportKey fails for NODE-ED25519 private keys", async (t) => {
  const alg = {
    name: 'NODE-ED25519',
    namedCurve: 'NODE-ED25519',
  };
  // generate keypair, since we can't import a private key
  // @ts-ignore type definition assumes CryptoKey, but result is CryptoKeyPair
  const { privateKey } = await crypto.subtle.generateKey(alg, false, ['sign']);
  t.not(privateKey, null)

  await t.throwsAsync(
    crypto.subtle.exportKey('raw', privateKey)
  );
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

test("crypto: generates aes key", async (t) => {
  const key = await crypto.subtle.generateKey(
    { name: "aes-gcm", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", key);
  t.is(exported.byteLength, 32);
});
