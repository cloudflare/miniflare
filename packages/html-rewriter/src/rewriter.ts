import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import { Response } from "@miniflare/core";
import type { DocumentHandlers, ElementHandlers } from "html-rewriter-wasm";
import { Response as BaseResponse } from "undici";

// Based on https://developer.mozilla.org/en-US/docs/Web/API/TransformStream#anything-to-uint8array_stream
const encoder = new TextEncoder();
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
function transformToArray(chunk: any): Uint8Array {
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
    throw new TypeError("Chunk must be defined");
  } else {
    return encoder.encode(String(chunk));
  }
}

const kElementHandlers = Symbol("kElementHandlers");
const kDocumentHandlers = Symbol("kDocumentHandlers");

type SelectorElementHandlers = [selector: string, handlers: ElementHandlers];

export class HTMLRewriter {
  private readonly [kElementHandlers]: SelectorElementHandlers[] = [];
  private readonly [kDocumentHandlers]: DocumentHandlers[] = [];

  on(selector: string, handlers: ElementHandlers): this {
    this[kElementHandlers].push([selector, handlers]);
    return this;
  }

  onDocument(handlers: DocumentHandlers): this {
    this[kDocumentHandlers].push(handlers);
    return this;
  }

  transform(response: BaseResponse): Response {
    const transformedStream = new ReadableStream({
      type: "bytes",
      start: async (controller) => {
        // Create a rewriter instance for this transformation that writes its
        // output to the transformed response's stream
        const { HTMLRewriter: BaseHTMLRewriter } = await import(
          "html-rewriter-wasm"
        );
        const rewriter = new BaseHTMLRewriter((output: Uint8Array) => {
          // enqueue will throw on empty chunks
          if (output.length !== 0) controller.enqueue(output);
        });
        // Add all registered handlers
        for (const [selector, handlers] of this[kElementHandlers]) {
          rewriter.on(selector, handlers);
        }
        for (const handlers of this[kDocumentHandlers]) {
          rewriter.onDocument(handlers);
        }

        try {
          // Transform the response body (may be null if empty)
          if (response.body) {
            for await (const chunk of response.body) {
              await rewriter.write(transformToArray(chunk));
            }
          }
          await rewriter.end();
        } catch (e) {
          controller.error(e);
        } finally {
          // Make sure the rewriter/controller are always freed/closed
          rewriter.free();
          controller.close();
        }
      },
    });

    // Return a response with the transformed body, copying over headers, etc,
    // returning a @miniflare/core Response so we don't need to convert
    // BaseResponse to one when dispatching fetch events
    return new Response(transformedStream, response);
  }
}
