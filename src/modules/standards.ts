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
import { ParsedHTMLRewriter } from "@mrbbot/parsed-html-rewriter";
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

export class HTMLRewriter extends ParsedHTMLRewriter {
  // @ts-expect-error we're using @mrbbot/node-fetch's types instead
  transform(response: Response): Response {
    // ParsedHTMLRewriter expects Response, TextEncoder and TransformStream to
    // be in the global scope so make sure they are, restoring them afterwards
    // :nauseated_face: (at least this function isn't async :sweat_smile:)
    const originalResponse = global.Response;
    const originalTextEncoder = global.TextEncoder;
    const originalTransformStream = global.TransformStream;
    // @ts-expect-error we're using @mrbbot/node-fetch's types instead
    global.Response = Response;
    global.TextEncoder = TextEncoder;
    // @ts-expect-error we're using web-streams-polyfill's types instead
    global.TransformStream = TransformStream;
    try {
      // @ts-expect-error we're using @mrbbot/node-fetch's types instead
      return super.transform(response);
    } finally {
      global.Response = originalResponse;
      global.TextEncoder = originalTextEncoder;
      global.TransformStream = originalTransformStream;
    }
  }
}

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
      TextDecoder,
      TextEncoder,

      fetch: this.fetch.bind(this),
      Headers,
      Request,
      Response,
      URL,
      URLSearchParams,

      HTMLRewriter,

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
