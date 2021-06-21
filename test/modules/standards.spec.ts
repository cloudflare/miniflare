import test from "ava";
import { NoOpLog } from "../../src";
import {
  StandardsModule,
  TextEncoder,
  atob,
  btoa,
  crypto,
} from "../../src/modules/standards";
import { runInWorker } from "../helpers";

test("atob: decodes base64 string", (t) => {
  t.is(atob("dGVzdA=="), "test");
});

test("btoa: encodes base64 string", (t) => {
  t.is(btoa("test"), "dGVzdA==");
});

test("crypto: computes md5 digest", async (t) => {
  const digest = await crypto.subtle.digest(
    "md5",
    new TextEncoder().encode("test")
  );
  t.is(Buffer.from(digest).toString("hex"), "098f6bcd4621d373cade4e832627b4f6");
});

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

test("buildSandbox: includes web standards", (t) => {
  const module = new StandardsModule(new NoOpLog());
  const sandbox = module.buildSandbox();

  t.true(typeof sandbox.console === "object");

  t.true(typeof sandbox.setTimeout === "function");
  t.true(typeof sandbox.setInterval === "function");
  t.true(typeof sandbox.clearTimeout === "function");
  t.true(typeof sandbox.clearInterval === "function");

  t.true(typeof sandbox.atob === "function");
  t.true(typeof sandbox.btoa === "function");

  t.true(typeof sandbox.crypto === "object");
  t.true(typeof sandbox.TextDecoder === "function");
  t.true(typeof sandbox.TextEncoder === "function");

  t.true(typeof sandbox.fetch === "function");
  t.true(typeof sandbox.Headers === "function");
  t.true(typeof sandbox.Request === "function");
  t.true(typeof sandbox.Response === "function");
  t.true(typeof sandbox.URL === "function");
  t.true(typeof sandbox.URLSearchParams === "function");

  t.true(typeof sandbox.ByteLengthQueuingStrategy === "function");
  t.true(typeof sandbox.CountQueuingStrategy === "function");
  t.true(typeof sandbox.ReadableByteStreamController === "function");
  t.true(typeof sandbox.ReadableStream === "function");
  t.true(typeof sandbox.ReadableStreamBYOBReader === "function");
  t.true(typeof sandbox.ReadableStreamBYOBRequest === "function");
  t.true(typeof sandbox.ReadableStreamDefaultController === "function");
  t.true(typeof sandbox.ReadableStreamDefaultReader === "function");
  t.true(typeof sandbox.TransformStream === "function");
  t.true(typeof sandbox.TransformStreamDefaultController === "function");
  t.true(typeof sandbox.WritableStream === "function");
  t.true(typeof sandbox.WritableStreamDefaultController === "function");
  t.true(typeof sandbox.WritableStreamDefaultWriter === "function");

  t.true(typeof sandbox.ArrayBuffer === "function");
  t.true(typeof sandbox.Atomics === "object");
  t.true(typeof sandbox.BigInt64Array === "function");
  t.true(typeof sandbox.BigUint64Array === "function");
  t.true(typeof sandbox.DataView === "function");
  t.true(typeof sandbox.Date === "function");
  t.true(typeof sandbox.Float32Array === "function");
  t.true(typeof sandbox.Float64Array === "function");
  t.true(typeof sandbox.Int8Array === "function");
  t.true(typeof sandbox.Int16Array === "function");
  t.true(typeof sandbox.Int32Array === "function");
  t.true(typeof sandbox.Map === "function");
  t.true(typeof sandbox.Promise === "function");
  t.true(typeof sandbox.SharedArrayBuffer === "function");
  t.true(typeof sandbox.Uint8Array === "function");
  t.true(typeof sandbox.Uint8ClampedArray === "function");
  t.true(typeof sandbox.Uint16Array === "function");
  t.true(typeof sandbox.Uint32Array === "function");
  t.true(typeof sandbox.WeakMap === "function");
  t.true(typeof sandbox.WebAssembly === "object");
});

test("buildSandbox: can use instanceof with literals", async (t) => {
  const result = await runInWorker({}, async () => {
    return {
      array: [] instanceof Array,
      object: {} instanceof Object,
      function: (() => {}) instanceof Function,
    };
  });
  t.true(result.array);
  t.true(result.object);
  t.true(result.function);
});
