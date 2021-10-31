import { ReadableStream } from "stream/web";
import { TextEncoder } from "util";
import { Response } from "@miniflare/core";
import type { DocumentHandlers, ElementHandlers } from "html-rewriter-wasm";
import { Response as BaseResponse } from "undici";

// TODO: remove this function and these conversions, Workers only allows byte streams for Responses
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

type SelectorElementHandlers = [selector: string, handlers: ElementHandlers];

export class HTMLRewriter {
  readonly #elementHandlers: SelectorElementHandlers[] = [];
  readonly #documentHandlers: DocumentHandlers[] = [];

  on(selector: string, handlers: ElementHandlers): this {
    this.#elementHandlers.push([selector, handlers]);
    return this;
  }

  onDocument(handlers: DocumentHandlers): this {
    this.#documentHandlers.push(handlers);
    return this;
  }

  transform(response: BaseResponse | Response): Response {
    const transformedStream = new ReadableStream<Uint8Array>({
      type: "bytes",
      start: async (controller) => {
        // Create a rewriter instance for this transformation that writes its
        // output to the transformed response's stream. Note that each
        // BaseHTMLRewriter can only be used once. Importing html-rewriter-wasm
        // will also synchronously compile a WebAssembly module, so delay doing
        // this until we really need it.
        const { HTMLRewriter: BaseHTMLRewriter } = await import(
          "html-rewriter-wasm"
        );
        const rewriter = new BaseHTMLRewriter((output: Uint8Array) => {
          // enqueue will throw on empty chunks
          if (output.length !== 0) controller.enqueue(output);
        });
        // Add all registered handlers
        for (const [selector, handlers] of this.#elementHandlers) {
          rewriter.on(selector, handlers);
        }
        for (const handlers of this.#documentHandlers) {
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
    const res = new Response(transformedStream, response);
    res.headers.delete("Content-Length");
    return res;
  }
}
