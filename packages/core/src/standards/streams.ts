import {
  ReadableStreamBYOBReadResult,
  ReadableStreamBYOBReader,
  TransformStream,
} from "stream/web";
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

export const kContentLength = Symbol("kContentLength");

export class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expectedLength: number) {
    // noinspection SuspiciousTypeOfGuard
    if (typeof expectedLength !== "number" || expectedLength < 0) {
      throw new TypeError(
        "FixedLengthStream requires a non-negative integer expected length."
      );
    }

    // Keep track of the number of bytes written
    let written = 0;
    super({
      transform(chunk, controller) {
        // Make sure this chunk is an ArrayBuffer(View)
        if (isBufferSource(chunk)) {
          const array = bufferSourceToArray(chunk);

          // Throw if written too many bytes
          written += array.byteLength;
          if (written > expectedLength) {
            return controller.error(
              new TypeError(
                "Attempt to write too many bytes through a FixedLengthStream."
              )
            );
          }

          controller.enqueue(array);
        } else {
          controller.error(new TypeError(buildNotBufferSourceError(chunk)));
        }
      },
      flush(controller) {
        // Throw if not written enough bytes on close
        if (written < expectedLength) {
          controller.error(
            new TypeError(
              "FixedLengthStream did not see all expected bytes before close()."
            )
          );
        }
      },
    });

    // When used as Request/Response body, override the Content-Length header
    // with the expectedLength
    (this.readable as any)[kContentLength] = expectedLength;
  }
}
