import { ReadableStream, TransformStream } from "stream/web";
import { Response } from "@miniflare/core";
import type {
  HTMLRewriter as BaseHTMLRewriter,
  DocumentHandlers,
  ElementHandlers,
} from "html-rewriter-wasm";
import { Response as BaseResponse } from "undici";

function transformToArray(chunk: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  } else if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  } else {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
}

type SelectorElementHandlers = [selector: string, handlers: ElementHandlers];

// noinspection SuspiciousTypeOfGuard
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
    let rewriter: BaseHTMLRewriter;
    const transformStream = new TransformStream<
      ArrayBuffer | ArrayBufferView,
      Uint8Array
    >({
      start: async (controller) => {
        // Create a rewriter instance for this transformation that writes its
        // output to the transformed response's stream. Note that each
        // BaseHTMLRewriter can only be used once. Importing html-rewriter-wasm
        // will also synchronously compile a WebAssembly module, so delay doing
        // this until we really need it.
        const { HTMLRewriter: BaseHTMLRewriter } = await import(
          "html-rewriter-wasm"
        );
        rewriter = new BaseHTMLRewriter((output) => {
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
      },
      transform: async (chunk) => {
        if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
          try {
            // Make sure we're passing a Uint8Array to Rust glue
            return await rewriter.write(transformToArray(chunk));
          } catch (e) {
            // Make sure the rewriter is always freed (if transformer
            // transform() throws an error, transformer flush() won't be called)
            rewriter.free();
            throw e;
          }
        } else {
          rewriter.free();
          const isString = typeof chunk === "string";
          throw new TypeError(
            "This TransformStream is being used as a byte stream, but received " +
              (isString
                ? "a string on its writable side. If you wish to write a string, " +
                  "you'll probably want to explicitly UTF-8-encode it with TextEncoder."
                : "an object of non-ArrayBuffer/ArrayBufferView type on its writable side.")
          );
        }
      },
      flush: async () => {
        try {
          // Runs document end handlers
          return await rewriter.end();
        } finally {
          // Make sure the rewriter is always freed, regardless of whether
          // rewriter.end() throws
          rewriter.free();
        }
      },
    });

    // Return a response with the transformed body, copying over headers, etc,
    // returning a @miniflare/core Response so we don't need to convert
    // BaseResponse to one when dispatching fetch events.
    const body = response.body as ReadableStream<Uint8Array> | null;
    const res = new Response(body?.pipeThrough(transformStream), response);
    // If Content-Length is set, it's probably going to be wrong, since we're
    // rewriting content, so remove it
    res.headers.delete("Content-Length");
    return res;
  }
}
