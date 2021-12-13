export function isBufferSource(chunk: unknown): chunk is BufferSource {
  return chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk);
}

export function bufferSourceToArray(chunk: BufferSource): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  } else if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  } else {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
}

export function buildNotBufferSourceError(value: unknown): string {
  const isString = typeof value === "string";
  return (
    "This TransformStream is being used as a byte stream, but received " +
    (isString
      ? "a string on its writable side. If you wish to write a string, " +
        "you'll probably want to explicitly UTF-8-encode it with TextEncoder."
      : "an object of non-ArrayBuffer/ArrayBufferView type on its writable side.")
  );
}
