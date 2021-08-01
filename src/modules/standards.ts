import { BinaryLike, createHash, webcrypto as crypto } from "crypto";
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
} from "stream/web";
import { URL, URLSearchParams } from "url";
import { TextDecoder, TextEncoder } from "util";
import originalFetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "@mrbbot/node-fetch";
import FormData from "formdata-node";
import WebSocket from "ws";
import { Log } from "../log";
import { Context, Module } from "./module";
import { WebSocketPair, terminateWebSocket } from "./ws";

export {
  URL,
  URLSearchParams,
  TextDecoder,
  TextEncoder,
  Headers,
  FormData,
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
  crypto,
};

export function atob(s: string): string {
  return Buffer.from(s, "base64").toString("binary");
}

export function btoa(s: string): string {
  return Buffer.from(s, "binary").toString("base64");
}

export const CryptoKey = crypto.CryptoKey;
// Override the digest function to add support for MD5 digests which aren't
// part of the WebCrypto standard, but are supported in Workers
const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = function (algorithm, data) {
  const algorithmName =
    typeof algorithm === "string" ? algorithm : algorithm?.name;
  if (algorithmName?.toLowerCase() == "md5") {
    if (data instanceof ArrayBuffer) data = Buffer.from(data);
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
  private webSockets: WebSocket[];
  private readonly sandbox: Context;

  constructor(log: Log) {
    // TODO: (low priority) proxy Date.now() and add warning, maybe new Date() too?
    super(log);
    this.webSockets = [];
    this.sandbox = {
      console,

      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,

      atob,
      btoa,

      crypto,
      CryptoKey,
      TextDecoder,
      TextEncoder,

      fetch: this.fetch.bind(this),
      Headers,
      Request,
      Response,
      FormData,
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

      // The types below would be included automatically, but it's not possible
      // to create instances of them without using their constructors and they
      // may be returned from Miniflare's realm (e.g. ArrayBuffer responses,
      // Durable Object listed keys) so it makes sense to share these so
      // instanceof behaves correctly.
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
      Set,
      SharedArrayBuffer,
      Uint8Array,
      Uint8ClampedArray,
      Uint16Array,
      Uint32Array,
      WeakMap,
      WeakSet,
      WebAssembly,

      // The types below are included automatically. By not including Array,
      // Object, Function and RegExp, instanceof will return true for these
      // types on literals. JSON.parse will return instances of its realm's
      // objects/arrays too, hence it is not included. See tests for examples.
      //
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
      // Promise,
      // Proxy,
      // RangeError,
      // ReferenceError,
      // Reflect,
      // RegExp,
      // String,
      // Symbol,
      // SyntaxError,
      // TypeError,
      // URIError,
      // Intl,
      // JSON,
    };
  }

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);

    // Cloudflare ignores request Host
    request.headers.delete("host");

    // Handle web socket upgrades
    if (request.headers.get("upgrade") === "websocket") {
      // Establish web socket connection
      const headers: Record<string, string> = {};
      for (const [key, value] of request.headers.entries()) {
        headers[key] = value;
      }
      const ws = new WebSocket(request.url, {
        followRedirects: request.redirect === "follow",
        maxRedirects: request.follow,
        headers,
      });
      this.webSockets.push(ws);

      // Terminate web socket with pair and resolve
      const [worker, client] = Object.values(new WebSocketPair());
      await terminateWebSocket(ws, client);
      return new Response(null, { webSocket: worker });
    }

    // TODO: (low priority) support cache using fetch:
    //  https://developers.cloudflare.com/workers/learning/how-the-cache-works#fetch
    //  https://developers.cloudflare.com/workers/examples/cache-using-fetch

    return originalFetch(request);
  }

  resetWebSockets(): void {
    // Ensure all fetched web sockets are closed
    for (const ws of this.webSockets) {
      ws.close(1012, "Service Restart");
    }
    this.webSockets = [];
  }

  buildSandbox(): Context {
    return this.sandbox;
  }
}
