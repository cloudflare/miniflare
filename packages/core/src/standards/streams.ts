import type { Transform } from "stream";
import {
  ReadableStream,
  ReadableStreamBYOBReadResult,
  ReadableStreamBYOBReader,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  Transformer,
} from "stream/web";
import zlib from "zlib";
import {
  bufferSourceToArray,
  buildNotBufferSourceError,
  isBufferSource,
} from "./helpers";

export type ArrayBufferViewConstructor =
  | typeof Int8Array
  | typeof Uint8Array
  | typeof Uint8ClampedArray
  | typeof Int16Array
  | typeof Uint16Array
  | typeof Int32Array
  | typeof Uint32Array
  | typeof Float32Array
  | typeof Float64Array
  | typeof DataView;

// Manipulating the prototype like this isn't very nice. However, this is a
// non-standard function so it's unlikely to cause problems with other people's
// code. Miniflare is also usually the only thing running in a process.
// The alternative would probably be to subclass ReadableStream and
// ReadableStreamBYOBReader, then use instances of those instead like we do
// for Request and Response. We'd also need to subclass TransformStream too,
// since internally it would return an instance of the normal ReadableStream.
ReadableStreamBYOBReader.prototype.readAtLeast = async function <
  T extends ArrayBufferView
>(bytes: number, view: T): Promise<ReadableStreamBYOBReadResult<T>> {
  const { byteOffset, byteLength } = view;
  if (isNaN(bytes) || bytes <= 0) {
    throw new TypeError(
      `Requested invalid minimum number of bytes to read (${bytes}).`
    );
  }
  if (byteLength <= 0) {
    throw new TypeError(
      'You must call read() on a "byob" reader with a positive-sized TypedArray object.'
    );
  }
  if (bytes > byteLength) {
    throw new TypeError(
      `Minimum bytes to read (${bytes}) exceeds size of buffer (${byteLength}).`
    );
  }

  const proto = Object.getPrototypeOf(view);
  const bytesPerElement = proto.BYTES_PER_ELEMENT ?? 1;
  const ctor: ArrayBufferViewConstructor = proto.constructor;

  let buffer = view.buffer;
  let read = 0;
  let done = false;
  // assert(byteLength > 0 && bytes > 0) so this loop must run at least once,
  // meaning done will be set to true if it's meant to be.

  while (read < byteLength && read < bytes) {
    const result = await this.read(
      new ctor(buffer, byteOffset + read, (byteLength - read) / bytesPerElement)
    );
    if (result.value) {
      buffer = result.value.buffer;
      read += result.value.byteLength;
    }
    if (result.done) {
      // Require final readAtLeast() call to get done = true as Workers do
      done = read === 0;
      break;
    }
  }

  const value = new ctor(buffer, byteOffset, read / bytesPerElement);
  return { value: value as any, done };
};

const kTransformHook = Symbol("kTransformHook");
const kFlushHook = Symbol("kFlushHook");

export class IdentityTransformStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  #readableByteStream?: ReadableStream<Uint8Array>;

  // Hooks for FixedLengthStream
  [kTransformHook]?: (
    chunk: Uint8Array,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => boolean;
  [kFlushHook]?: (
    controller: TransformStreamDefaultController<Uint8Array>
  ) => void;

  constructor() {
    super({
      transform: (chunk, controller) => {
        // Make sure this chunk is an ArrayBuffer(View)
        if (isBufferSource(chunk)) {
          const array = bufferSourceToArray(chunk);
          if (this[kTransformHook]?.(array, controller) === false) return;
          controller.enqueue(array);
        } else {
          controller.error(new TypeError(buildNotBufferSourceError(chunk)));
        }
      },
      flush: (controller) => this[kFlushHook]?.(controller),
    });
  }

  get readable() {
    if (this.#readableByteStream !== undefined) return this.#readableByteStream;
    const readable = super.readable;
    let reader: ReadableStreamDefaultReader;
    return (this.#readableByteStream = new ReadableStream({
      type: "bytes",
      start() {
        reader = readable.getReader();
      },
      async pull(controller) {
        let { done, value } = await reader.read();
        // Make sure we eventually call a `controller` method, either because
        // we're done, or there's data to enqueue
        while (!done && value.byteLength === 0) {
          const result = await reader.read();
          done = result.done;
          value = result.value;
        }
        if (done) {
          queueMicrotask(() => {
            controller.close();
            // Not documented in MDN but if there's an ongoing request that's waiting,
            // we need to tell it that there were 0 bytes delivered so that it unblocks
            // and notices the end of stream.
            // @ts-expect-error `byobRequest` has type `undefined` in `@types/node`
            controller.byobRequest?.respond(0);
          });
        } else if (value.byteLength > 0) {
          // Ensure chunk if non-empty before enqueuing:
          // https://github.com/cloudflare/miniflare/issues/374
          controller.enqueue(value);
        }
      },
      cancel() {
        return reader.cancel();
      },
    }));
  }
}

export const kContentLength = Symbol("kContentLength");

export class FixedLengthStream extends IdentityTransformStream {
  readonly #expectedLength: number;
  #bytesWritten = 0;

  constructor(expectedLength: number) {
    super();

    // noinspection SuspiciousTypeOfGuard
    if (typeof expectedLength !== "number" || expectedLength < 0) {
      throw new TypeError(
        "FixedLengthStream requires a non-negative integer expected length."
      );
    }
    this.#expectedLength = expectedLength;

    // When used as Request/Response body, override the Content-Length header
    // with the expectedLength
    Object.defineProperty(this.readable, kContentLength, {
      value: expectedLength,
    });
  }

  [kTransformHook] = (
    chunk: Uint8Array,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    // Throw if written too many bytes
    this.#bytesWritten += chunk.byteLength;
    if (this.#bytesWritten > this.#expectedLength) {
      controller.error(
        new TypeError(
          "Attempt to write too many bytes through a FixedLengthStream."
        )
      );
      return false;
    }
    return true;
  };

  [kFlushHook] = (controller: TransformStreamDefaultController<Uint8Array>) => {
    // Throw if not written enough bytes on close
    if (this.#bytesWritten < this.#expectedLength) {
      controller.error(
        new TypeError(
          "FixedLengthStream did not see all expected bytes before close()."
        )
      );
    }
  };
}

function createTransformerFromTransform(transform: Transform): Transformer {
  // TODO: backpressure? see https://github.com/nodejs/node/blob/440d95a878a1a19bf72a2685fc8fc0f47100b510/lib/internal/webstreams/adapters.js#L538
  return {
    start(controller) {
      transform.on("data", (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      transform.on("error", (error) => {
        controller.error(error);
      });
    },
    transform(chunk) {
      transform.write(chunk);
    },
    flush() {
      return new Promise((resolve) => {
        transform.once("close", () => {
          transform.removeAllListeners();
          resolve();
        });
        transform.end();
      });
    },
  };
}

// `(De)CompressionStream`s were added in Node.js 17.0.0. Our minimum supported
// version is 16.13.0, so we implement basic versions ourselves, preferring to
// use Node's if available.

export class CompressionStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(format: "gzip" | "deflate") {
    if (format !== "gzip" && format !== "deflate") {
      throw new TypeError(
        "The compression format must be either 'deflate' or 'gzip'."
      );
    }
    const transform =
      format === "gzip" ? zlib.createGzip() : zlib.createDeflate();
    super(createTransformerFromTransform(transform));
  }
}

export class DecompressionStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  constructor(format: "gzip" | "deflate") {
    if (format !== "gzip" && format !== "deflate") {
      throw new TypeError(
        "The compression format must be either 'deflate' or 'gzip'."
      );
    }
    const transform =
      format === "gzip" ? zlib.createGunzip() : zlib.createInflate();
    super(createTransformerFromTransform(transform));
  }
}
