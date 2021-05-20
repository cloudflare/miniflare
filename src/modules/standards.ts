import { BinaryLike, createHash } from "crypto";
import { URL, URLSearchParams } from "url";
import { TextDecoder, TextEncoder } from "util";
import fetch, { Headers, Request, Response } from "@mrbbot/node-fetch";
import { Crypto } from "@peculiar/webcrypto";
import {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} from "web-streams-polyfill/ponyfill/es6";
import { ProcessedOptions } from "../options";
import { Module, Sandbox } from "./module";

export {
  URL,
  URLSearchParams,
  TextDecoder,
  TextEncoder,
  fetch,
  Headers,
  Request,
  Response,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
};

export function atob(s: string): string {
  return Buffer.from(s, "base64").toString("binary");
}

export function btoa(s: string): string {
  return Buffer.from(s, "binary").toString("base64");
}

export const crypto = new Crypto();
// Override the digest function to add support for MD5 digests which aren't
// part of the WebCrypto standard, but are supported in Workers
const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = function (algorithm, data) {
  const algorithmName =
    typeof algorithm === "string" ? algorithm : algorithm?.name;
  if (algorithmName?.toLowerCase() == "md5") {
    return Promise.resolve(
      createHash("md5")
        .update(data as BinaryLike)
        .digest().buffer
    );
  }

  // If the algorithm isn't MD5, defer to the original function
  return originalDigest(algorithm, data);
};

export class StandardsModule extends Module {
  buildSandbox(_options: ProcessedOptions): Sandbox {
    // TODO: proxy Date.now() and add warning, maybe new Date() too?
    return {
      console,

      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,

      atob,
      btoa,

      crypto,
      TextDecoder,
      TextEncoder,

      fetch, // TODO: handle upstream correctly
      Headers,
      Request,
      Response,
      URL,
      URLSearchParams,

      ByteLengthQueuingStrategy,
      CountQueuingStrategy,
      ReadableByteStreamController,
      ReadableStream,
      ReadableStreamBYOBReader,
      ReadableStreamBYOBRequest,
      ReadableStreamDefaultController,
      ReadableStreamDefaultReader,
      TransformStream,
      TransformStreamDefaultController,
      WritableStream,
      WritableStreamDefaultController,
      WritableStreamDefaultWriter,

      ArrayBuffer,
      Atomics,
      BigInt64Array,
      BigUint64Array,
      DataView,
      Date,
      Float32Array,
      Float64Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Map,
      Promise,
      SharedArrayBuffer,
      Uint8Array,
      Uint8ClampedArray,
      Uint16Array,
      Uint32Array,
      WeakMap,
      WebAssembly, // TODO: check this works correctly

      // TODO: document decision not to include Object, Array, etc
      // TODO: tidy these up, sort sensibly too
      // Array,
      // Boolean,
      // Function,
      // Error,
      // EvalError,
      // Math,
      // NaN,
      // Number,
      // BigInt,
      // Object,
      // Proxy,
      // RangeError,
      // ReferenceError,
      // Reflect,
      // RegExp,
      // Set,
      // String,
      // Symbol,
      // SyntaxError,
      // TypeError,
      // URIError,
      // Intl,
      // JSON,
    };
  }
}
