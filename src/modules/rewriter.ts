import { TextEncoder } from "util";
import { Response } from "@mrbbot/node-fetch";
import {
  HTMLRewriter as BaseHTMLRewriter,
  Comment,
  ContentTypeOptions,
  Doctype,
  DocumentEnd,
  DocumentHandlers,
  Element,
  ElementHandlers,
  TextChunk,
} from "html-rewriter-wasm";
import { ReadableStream } from "web-streams-polyfill/ponyfill/es6";
import { Context, Module } from "./module";

// Based on https://developer.mozilla.org/en-US/docs/Web/API/TransformStream#anything-to-uint8array_stream
const encoder = new TextEncoder();
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function transformToArray(chunk: any): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  } else if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  } else if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  } else if (
    Array.isArray(chunk) &&
    chunk.every((value) => typeof value === "number")
  ) {
    return new Uint8Array(chunk);
  } else if (typeof chunk === "number") {
    return new Uint8Array([chunk]);
  } else if (chunk === null || chunk === undefined) {
    throw new TypeError("chunk must be defined");
  } else {
    return encoder.encode(String(chunk));
  }
}

export class HTMLRewriter {
  #elementHandlers: [selector: string, handlers: any][] = [];
  #documentHandlers: any[] = [];

  on(selector: string, handlers: ElementHandlers): this {
    // Ensure handlers register returned promises, and `this` is bound correctly
    const wrappedHandlers = {
      element: handlers.element?.bind(handlers),
      comments: handlers.comments?.bind(handlers),
      text: handlers.text?.bind(handlers),
    };
    this.#elementHandlers.push([selector, wrappedHandlers]);
    return this;
  }

  onDocument(handlers: DocumentHandlers): this {
    // Ensure handlers register returned promises, and `this` is bound correctly
    const wrappedHandlers = {
      doctype: handlers.doctype?.bind(handlers),
      comments: handlers.comments?.bind(handlers),
      text: handlers.text?.bind(handlers),
      end: handlers.end?.bind(handlers),
    };
    this.#documentHandlers.push(wrappedHandlers);
    return this;
  }

  transform(response: Response): Response {
    const transformedStream = new ReadableStream({
      type: "bytes",
      start: async (controller) => {
        // Create a rewriter instance for this transformation that writes its
        // output to the transformed response's stream
        const rewriter = new BaseHTMLRewriter((output: Uint8Array) => {
          if (output.length === 0) {
            // Free the rewriter once it's finished doing its thing
            queueMicrotask(() => rewriter.free());
            controller.close();
          } else {
            controller.enqueue(output);
          }
        });
        // Add all registered handlers
        for (const [selector, handlers] of this.#elementHandlers) {
          rewriter.on(selector, handlers);
        }
        for (const handlers of this.#documentHandlers) {
          rewriter.onDocument(handlers);
        }

        // Transform the response body (may be null if empty)
        if (response.body) {
          for await (const chunk of response.body) {
            await rewriter.write(transformToArray(chunk));
          }
        }
        await rewriter.end();
      },
    });

    // Return a response with the transformed body, copying over headers, etc
    return new Response(transformedStream, response);
  }
}

export class HTMLRewriterModule extends Module {
  buildSandbox(): Context {
    return { HTMLRewriter };
  }
}

export {
  Element,
  Comment,
  TextChunk,
  Doctype,
  DocumentEnd,
  ContentTypeOptions,
};
