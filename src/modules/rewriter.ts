/// <reference types="@cloudflare/workers-types" />
import { TextEncoder } from "util";
import { Response } from "@mrbbot/node-fetch";
import { ReadableStream } from "web-streams-polyfill/ponyfill/es6";
// This import relies on dist having the same structure as src
import {
  HTMLRewriter as LOLHTMLRewriter,
  registerPromise,
} from "../../vendor/lol-html";
import { Mutex } from "../kv/helpers";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

function wrapHandler<T>(handler?: (arg: T) => void | Promise<void>) {
  if (handler === undefined) return undefined;
  return function (arg: T) {
    const result = handler(arg);
    // If this handler is async and returns a promise, register it and return
    // its handle so it can be awaited later in WebAssembly
    if (typeof result === "object" && typeof result.then === "function") {
      return registerPromise(result);
    }
    // Otherwise, return 0 to signal there's nothing to await
    return 0;
  };
}

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

/* The WebAssembly version of lol-html used by Miniflare uses asyncify for
 * async handlers. When a handler returns a promise, the WebAssembly stack is
 * stored in temporary storage, the promise is awaited, then the stack is
 * restored and WebAssembly execution continues where it left off. This
 * temporary storage is currently per module instance and we only have a single
 * instance because of how wasm-pack generates package code for NodeJS.
 * TODO: ideally, we would allocate each transform call its own temporary
 *  space for the saved stack.
 *
 * This means if you have multiple concurrent transforms in progress, the saved
 * stacks will be overwritten and lol-html will be unhappy. Therefore, to be
 * "safe", we need to make sure only one transform operation is in-progress at
 * any time, hence the mutex.
 *
 * However, this problem only occurs when using async handlers with concurrent
 * transforms. If just using sync handlers, or not doing multiple rewrites
 * concurrently (very likely), there's no need for the mutex, so we can use the
 * "unsafe" version. The "safe" version is the default just so people don't see
 * confusing errors. See the docs for concrete examples of where the "unsafe"
 * version can be used.
 */

const wasmModuleMutex = new Mutex();
// Symbol gives us "protected" method only accessible/overridable by subclass
const runCriticalSectionSymbol = Symbol("HTMLRewriter runCriticalSection");

export class UnsafeHTMLRewriter {
  #elementHandlers: [selector: string, handlers: any][] = [];
  #documentHandlers: any[] = [];

  on(selector: string, handlers: Partial<ElementHandler>): this {
    // Ensure handlers register returned promises, and `this` is bound correctly
    const wrappedHandlers = {
      element: wrapHandler(handlers.element?.bind(handlers)),
      comments: wrapHandler(handlers.comments?.bind(handlers)),
      text: wrapHandler(handlers.text?.bind(handlers)),
    };
    this.#elementHandlers.push([selector, wrappedHandlers]);
    return this;
  }

  onDocument(handlers: Partial<DocumentHandler>): this {
    // Ensure handlers register returned promises, and `this` is bound correctly
    const wrappedHandlers = {
      doctype: wrapHandler(handlers.doctype?.bind(handlers)),
      comments: wrapHandler(handlers.comments?.bind(handlers)),
      text: wrapHandler(handlers.text?.bind(handlers)),
      end: wrapHandler(handlers.end?.bind(handlers)),
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
        const rewriter = new LOLHTMLRewriter((output: Uint8Array) => {
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

        await this[runCriticalSectionSymbol](async () => {
          // Transform the response body (may be null if empty)
          if (response.body) {
            for await (const chunk of response.body) {
              await rewriter.write(transformToArray(chunk));
            }
          }
          await rewriter.end();
        });
      },
    });

    // Return a response with the transformed body, copying over headers, etc
    return new Response(transformedStream, response);
  }

  [runCriticalSectionSymbol](closure: () => Promise<void>): Promise<void> {
    return closure();
  }
}

// See big comment above for what this does and why it's needed. It's possible
// we'll remove this distinction in the future.
export class HTMLRewriter extends UnsafeHTMLRewriter {
  [runCriticalSectionSymbol](closure: () => Promise<void>): Promise<void> {
    return wasmModuleMutex.run(closure);
  }
}

export class HTMLRewriterModule extends Module {
  buildSandbox(options: ProcessedOptions): Context {
    return {
      HTMLRewriter: options.htmlRewriterUnsafe
        ? UnsafeHTMLRewriter
        : HTMLRewriter,
    };
  }
}
