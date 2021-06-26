import { BinaryLike, createHash } from "crypto";
import { URL, URLSearchParams } from "url";
import { TextDecoder, TextEncoder } from "util";
import originalFetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "@mrbbot/node-fetch";
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
    // TODO: proxy Date.now() and add warning, maybe new Date() too?
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
      TextDecoder,
      TextEncoder,

      fetch: this.fetch.bind(this),
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

  fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
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

      return new Promise((resolve, reject) => {
        ws.once("open", () => {
          // Terminate web socket with pair and resolve
          const [worker, client] = Object.values(new WebSocketPair());
          terminateWebSocket(ws, client);
          resolve(new Response(null, { webSocket: worker }));
        });
        ws.once("error", reject);
      });
    }

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
