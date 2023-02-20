import assert from "assert";
import { arrayBuffer, text } from "stream/consumers";
import {
  ReadableStream,
  ReadableStreamBYOBReadResult,
  TransformStream,
} from "stream/web";
import {
  ArrayBufferViewConstructor,
  CompressionStream,
  DecompressionStream,
  FixedLengthStream,
  IdentityTransformStream,
  Request,
  Response,
  _isBodyStream,
  _isByteStream,
  _isDisturbedStream,
  _isFixedLengthStream,
} from "@miniflare/core";
import { utf8Decode, utf8Encode } from "@miniflare/shared-test";
import test, { Macro, ThrowsExpectation } from "ava";

function chunkedStream(chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    type: "bytes",
    pull(controller) {
      const chunk = chunks.shift();
      assert(chunk);
      controller.enqueue(new Uint8Array(chunk));
      if (chunks.length === 0) controller.close();
    },
  });
}

async function* byobReadAtLeast<Ctor extends ArrayBufferViewConstructor>(
  stream: ReadableStream<Uint8Array>,
  readAtLeastBytes: number,
  bufferLength: number,
  ctor: Ctor
): AsyncGenerator<ReadableStreamBYOBReadResult<InstanceType<Ctor>>> {
  let buffer = new ArrayBuffer(bufferLength);
  let offset = 0;
  const reader = stream.getReader({ mode: "byob" });
  // @ts-expect-error ctor.BYTES_PER_ELEMENT will just be undefined for DataView
  const bytesPerElement = ctor.BYTES_PER_ELEMENT ?? 1;
  while (true /*offset < buffer.byteLength*/) {
    const view = new ctor(
      buffer,
      offset,
      (buffer.byteLength - offset) / bytesPerElement
    ) as InstanceType<Ctor>;
    const result = await reader.readAtLeast(readAtLeastBytes, view);
    yield result;
    if (result.value) {
      buffer = result.value.buffer;
      offset += result.value.byteLength;
    }
    // if (result.done) break;
  }
}

test("_isByteStream: determines if a ReadableStream is a byte stream", (t) => {
  const regularStream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const byteStream = new ReadableStream({
    type: "bytes",
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  t.false(_isByteStream(regularStream));
  t.true(_isByteStream(byteStream));
});
test("_isDisturbedStream: determines if a ReadableStream is disturbed", async (t) => {
  const regularStream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue("thing");
      controller.close();
    },
  });
  const byteStream = new ReadableStream({
    type: "bytes",
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  t.false(_isDisturbedStream(regularStream));
  t.false(_isDisturbedStream(byteStream));

  // @ts-expect-error ReadableStream types are incompatible
  await arrayBuffer(regularStream);
  t.true(_isDisturbedStream(regularStream));

  const reader = byteStream.getReader();
  t.false(_isDisturbedStream(byteStream));
  await reader.read();
  t.true(_isDisturbedStream(byteStream));
  await reader.releaseLock();
  t.true(_isDisturbedStream(byteStream));
});

test("ReadableStreamBYOBReader: readAtLeast: reads at least n bytes", async (t) => {
  const stream = chunkedStream([[1, 2, 3], [4], [5, 6]]);
  const reads = byobReadAtLeast(stream, 4, 8, Uint8Array);

  const { value } = await reads.next();
  assert(value);
  t.false(value.done);
  t.deepEqual(value.value, new Uint8Array([1, 2, 3, 4]));
});
test("ReadableStreamBYOBReader: readAtLeast: reads more than n bytes if available", async (t) => {
  const stream = chunkedStream([[1, 2, 3], [4, 5], [7]]);
  const reads = byobReadAtLeast(stream, 4, 8, Uint8Array);

  const { value } = await reads.next();
  assert(value);
  t.false(value.done);
  t.deepEqual(value.value, new Uint8Array([1, 2, 3, 4, 5]));
});
test("ReadableStreamBYOBReader: readAtLeast: reads less than n bytes if EOF reached", async (t) => {
  const stream = chunkedStream([[1], [2, 3], [4, 5]]);
  const reads = byobReadAtLeast(stream, 3, 8, Uint8Array);

  let value = (await reads.next()).value;
  assert(value);
  t.false(value.done);
  t.deepEqual(value.value, new Uint8Array([1, 2, 3]));

  value = (await reads.next()).value;
  assert(value);
  t.false(value.done); // final readAtLeast() call needed to get done = true
  t.deepEqual(value.value, new Uint8Array([4, 5]));

  value = (await reads.next()).value;
  assert(value);
  t.true(value.done);
  t.deepEqual(value.value, new Uint8Array([]));
});
test("ReadableStreamBYOBReader: readAtLeast: reads with Uint32Arrays", async (t) => {
  const stream = chunkedStream([
    [0x01, 0x02, 0x03],
    [0x04, 0x05],
    [0x06, 0x07, 0x08],
    [0x09, 0x10, 0x11, 0x12],
  ]);
  const reads = byobReadAtLeast(stream, 5, 20, Uint32Array);

  let value = (await reads.next()).value;
  assert(value);
  t.false(value.done);
  // Reading at least 5 bytes, but 4 required for each uint32, so 2 read
  t.deepEqual(value.value, new Uint32Array([0x04030201, 0x08070605]));

  value = (await reads.next()).value;
  assert(value);
  t.false(value.done);
  t.deepEqual(value.value, new Uint32Array([0x12111009]));

  value = (await reads.next()).value;
  assert(value);
  t.true(value.done);
  t.deepEqual(value.value, new Uint32Array([]));
});
test("ReadableStreamBYOBReader: readAtLeast: throws with Uint32Arrays on partial read", async (t) => {
  const stream = chunkedStream([
    [0x01, 0x02, 0x03, 0x04],
    [0x05, 0x06, 0x07],
  ]);
  const reads = byobReadAtLeast(stream, 5, 20, Uint32Array);
  await t.throwsAsync(reads.next(), {
    instanceOf: TypeError,
    message: "Invalid state: Partial read",
  });
});
// See https://github.com/nodejs/node/issues/40612
// test("ReadableStreamBYOBReader: readAtLeast: reads with DataViews", async (t) => {
//   const stream = chunkedStream([[1, 2, 3], [4], [5, 6]]);
//   const reads = byobReadAtLeast(stream, 4, 8, DataView);
//
//   const { value } = await reads.next();
//   assert(value);
//   t.false(value.done);
//   const buffer = new ArrayBuffer(4);
//   const array = new Uint8Array(buffer);
//   array[0] = 1;
//   array[1] = 2;
//   array[2] = 3;
//   array[3] = 4;
//   t.deepEqual(value.value, new DataView(buffer));
// });

test("ReadableStreamBYOBReader: readAtLeast: throws with invalid minimum number of bytes", async (t) => {
  let stream = chunkedStream([]);
  let reads = byobReadAtLeast(stream, -3, 8, Uint8Array);
  await t.throwsAsync(reads.next(), {
    instanceOf: TypeError,
    message: `Requested invalid minimum number of bytes to read (-3).`,
  });

  stream = chunkedStream([]);
  reads = byobReadAtLeast(stream, 0, 8, Uint8Array);
  await t.throwsAsync(reads.next(), {
    instanceOf: TypeError,
    message: `Requested invalid minimum number of bytes to read (0).`,
  });

  stream = chunkedStream([]);
  // @ts-expect-error testing error with invalid type
  reads = byobReadAtLeast(stream, "not a number", 8, Uint8Array);
  await t.throwsAsync(reads.next(), {
    instanceOf: TypeError,
    message: `Requested invalid minimum number of bytes to read (not a number).`,
  });
});
test("ReadableStreamBYOBReader: readAtLeast: throws with non-positive-sized TypedArray", async (t) => {
  const stream = chunkedStream([]);
  const buffer = new ArrayBuffer(8);
  const reader = stream.getReader({ mode: "byob" });
  await t.throwsAsync(reader.readAtLeast(3, new Uint8Array(buffer, 0, 0)), {
    instanceOf: TypeError,
    message:
      'You must call read() on a "byob" reader with a positive-sized TypedArray object.',
  });
});
test("ReadableStreamBYOBReader: readAtLeast: throws if minimum number of bytes exceeds buffer size", async (t) => {
  const stream = chunkedStream([]);
  const buffer = new ArrayBuffer(8);
  const reader = stream.getReader({ mode: "byob" });
  await t.throwsAsync(reader.readAtLeast(4, new Uint8Array(buffer, 0, 3)), {
    instanceOf: TypeError,
    message: "Minimum bytes to read (4) exceeds size of buffer (3).",
  });
});

test("ReadableStream: tee: returns byte streams when teeing byte stream", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/317
  const stream = chunkedStream([[1, 2, 3]]);
  t.true(_isByteStream(stream));
  const [stream1, stream2] = stream.tee();
  t.true(_isByteStream(stream1));
  t.true(_isByteStream(stream2));

  // Check detaching array buffers on one stream doesn't affect the other
  // (note Response#body will detach chunks as reading)
  // https://github.com/cloudflare/miniflare/issues/375
  const body1 = await arrayBuffer(new Response(stream1).body as any);
  const body2 = await arrayBuffer(new Response(stream2).body as any);
  t.deepEqual(new Uint8Array(body1), new Uint8Array([1, 2, 3]));
  t.deepEqual(new Uint8Array(body2), new Uint8Array([1, 2, 3]));
});
test("ReadableStream: tee: returns regular stream when teeing regular stream", async (t) => {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("value");
      controller.close();
    },
  });
  t.false(_isByteStream(stream));
  const [stream1, stream2] = stream.tee();
  t.false(_isByteStream(stream1));
  t.false(_isByteStream(stream2));
  t.is(await text(stream1 as any), "value");
  t.is(await text(stream2 as any), "value");
});
test("ReadableStream: tee: returns known length streams when teeing known length streams", async (t) => {
  const fixedLengthStream = new FixedLengthStream(3);
  let [stream1, stream2] = fixedLengthStream.readable.tee();
  t.true(_isFixedLengthStream(stream1));
  t.true(_isFixedLengthStream(stream2));

  const req = new Request("http://localhost", { method: "POST", body: "body" });
  assert(req.body !== null);
  [stream1, stream2] = req.body.tee();
  t.true(_isBodyStream(stream1));
  t.true(_isBodyStream(stream2));

  const res = new Response("body");
  assert(res.body !== null);
  [stream1, stream2] = res.body.tee();
  t.true(_isBodyStream(stream1));
  t.true(_isBodyStream(stream2));
});
test("ReadableStream: tee: throws on illegal invocation", (t) => {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.close();
    },
  });
  // @ts-expect-error using comma expression to unbind this
  // noinspection CommaExpressionJS
  t.throws(() => (0, stream.tee)(), {
    instanceOf: TypeError,
    message: "Illegal invocation",
  });
});

const identityMacro: Macro<[TransformStream]> = async (t, stream) => {
  const { readable, writable } = stream;
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([1, 2]));
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([3]));
  // noinspection ES6MissingAwait
  void writer.close();

  const reader = readable.getReader();
  t.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  t.deepEqual((await reader.read()).value, new Uint8Array([3]));
  t.true((await reader.read()).done);
};
const identityByobMacro: Macro<[TransformStream]> = async (t, stream) => {
  const { readable, writable } = stream;
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([1]));
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([2, 3]));
  // noinspection ES6MissingAwait
  void writer.close();

  const reads = byobReadAtLeast(readable, 3, 8, Uint8Array);

  let value = (await reads.next()).value;
  assert(value);
  t.false(value.done);
  t.deepEqual(value.value, new Uint8Array([1, 2, 3]));

  value = (await reads.next()).value;
  assert(value);
  t.true(value.done);
  t.deepEqual(value.value, new Uint8Array([]));
};
const identityStringChunkMacro: Macro<[TransformStream]> = async (
  t,
  stream
) => {
  const { readable, writable } = stream;
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(
    "how much chunk would a chunk-chuck chuck if a chunk-chuck could chuck chunk?"
  );

  const reader = readable.getReader();
  await t.throwsAsync(reader.read(), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received a string on its writable side. " +
      "If you wish to write a string, you'll probably want to " +
      "explicitly UTF-8-encode it with TextEncoder.",
  });
};
const identityNonArrayChunkMacro: Macro<[TransformStream]> = async (
  t,
  stream
) => {
  const { readable, writable } = stream;
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(42);

  const reader = readable.getReader();
  await t.throwsAsync(reader.read(), {
    instanceOf: TypeError,
    message:
      "This TransformStream is being used as a byte stream, " +
      "but received an object of non-ArrayBuffer/ArrayBufferView " +
      "type on its writable side.",
  });
};
test(
  "IdentityTransformStream: behaves as identity transform",
  identityMacro,
  new IdentityTransformStream()
);
test(
  "IdentityTransformStream: permits BYOB reads",
  identityByobMacro,
  new IdentityTransformStream()
);
test(
  "IdentityTransformStream: throws on string chunks",
  identityStringChunkMacro,
  new IdentityTransformStream()
);
test(
  "IdentityTransformStream: throws on non-ArrayBuffer/ArrayBufferView chunks",
  identityNonArrayChunkMacro,
  new IdentityTransformStream()
);
test("IdentityTransformStream: doesn't throw on empty chunk write", async (t) => {
  // https://github.com/cloudflare/miniflare/issues/374
  const { readable, writable } = new IdentityTransformStream();
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array());
  // noinspection ES6MissingAwait
  void writer.close();
  const array = new Uint8Array(await arrayBuffer(readable as any));
  t.deepEqual(array, new Uint8Array());
});

test("FixedLengthStream: requires non-negative integer expected length", (t) => {
  const expectations: ThrowsExpectation = {
    instanceOf: TypeError,
    message:
      "FixedLengthStream requires a non-negative integer expected length.",
  };
  // @ts-expect-error intentionally testing incorrect types
  t.throws(() => new FixedLengthStream(), expectations);
  t.throws(() => new FixedLengthStream(-42), expectations);
  new FixedLengthStream(0);
});
test("FixedLengthStream: throws if too many bytes written", async (t) => {
  const { readable, writable } = new FixedLengthStream(3);
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([1, 2]));
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([3, 4]));

  const reader = readable.getReader();
  t.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  await t.throwsAsync(reader.read(), {
    instanceOf: TypeError,
    message: "Attempt to write too many bytes through a FixedLengthStream.",
  });
});
test("FixedLengthStream: throws if too few bytes written", async (t) => {
  const { readable, writable } = new FixedLengthStream(3);
  const writer = writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array([1, 2]));
  // noinspection ES6MissingAwait
  const closePromise = writer.close();

  const reader = readable.getReader();
  t.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  await t.throwsAsync(closePromise, {
    instanceOf: TypeError,
    message: "FixedLengthStream did not see all expected bytes before close().",
  });
});
test(
  "FixedLengthStream: behaves as identity transform if just right number of bytes written",
  identityMacro,
  new FixedLengthStream(3)
);
test(
  "FixedLengthStream: permits BYOB reads",
  identityByobMacro,
  new FixedLengthStream(3)
);
test(
  "FixedLengthStream: throws on string chunks",
  identityStringChunkMacro,
  new FixedLengthStream(5)
);
test(
  "FixedLengthStream: throws on non-ArrayBuffer/ArrayBufferView chunks",
  identityNonArrayChunkMacro,
  new FixedLengthStream(5)
);
function buildFixedLengthReadableStream(length: number) {
  const { readable, writable } = new FixedLengthStream(length);
  const writer = writable.getWriter();
  if (length > 0) void writer.write(utf8Encode("".padStart(length, "x")));
  void writer.close();
  return readable;
}
test("FixedLengthStream: sets Content-Length header on Request", async (t) => {
  let body = buildFixedLengthReadableStream(3);
  let req = new Request("http://localhost", { method: "POST", body });
  t.is(req.headers.get("Content-Length"), "3");
  t.is(await req.text(), "xxx");

  // Check overrides existing Content-Length header
  body = buildFixedLengthReadableStream(3);
  req = new Request("http://localhost", {
    method: "POST",
    body,
    headers: { "Content-Length": "2" },
  });
  t.is(req.headers.get("Content-Length"), "3");
  t.is(await req.text(), "xxx");

  // Check still includes header with 0 expected length
  body = buildFixedLengthReadableStream(0);
  req = new Request("http://localhost", { method: "POST", body });
  t.is(req.headers.get("Content-Length"), "0");
  t.is(await req.text(), "");
});
test("FixedLengthStream: sets Content-Length header on Response", async (t) => {
  let body = buildFixedLengthReadableStream(3);
  let res = new Response(body);
  t.is(res.headers.get("Content-Length"), "3");
  t.is(await res.text(), "xxx");

  // Check overrides existing Content-Length header
  body = buildFixedLengthReadableStream(3);
  res = new Response(body, { headers: { "Content-Length": "2" } });
  t.is(res.headers.get("Content-Length"), "3");
  t.is(await res.text(), "xxx");

  // Check still includes header with 0 expected length
  body = buildFixedLengthReadableStream(0);
  res = new Response(body);
  t.is(res.headers.get("Content-Length"), "0");
  t.is(await res.text(), "");
});

const compressionMacro: Macro<["gzip" | "deflate"]> = async (t, format) => {
  const data = "".padStart(1024, "x");

  const compressor = new CompressionStream(format);
  let writer = compressor.writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(utf8Encode(data));
  // noinspection ES6MissingAwait
  void writer.close();
  // @ts-expect-error ReadableStream types are incompatible
  const compressed = await arrayBuffer(compressor.readable);
  // Make sure data compressed
  t.true(compressed.byteLength < data.length);

  const decompressor = new DecompressionStream(format);
  writer = decompressor.writable.getWriter();
  // noinspection ES6MissingAwait
  void writer.write(new Uint8Array(compressed));
  // noinspection ES6MissingAwait
  void writer.close();
  // @ts-expect-error ReadableStream types are incompatible
  const decompressed = await arrayBuffer(decompressor.readable);
  // Make sure original data recovered
  t.is(utf8Decode(new Uint8Array(decompressed)), data);
};
compressionMacro.title = (providedTitle, format) =>
  `(De)CompressionStream: (de)compresses ${format} data`;
test(compressionMacro, "gzip");
test(compressionMacro, "deflate");
test("(De)CompressionStream: throws on invalid format", (t) => {
  const expectations: ThrowsExpectation = {
    instanceOf: TypeError,
    message: "The compression format must be either 'deflate' or 'gzip'.",
  };
  // @ts-expect-error intentionally testing incorrect types
  t.throws(() => new CompressionStream("invalid"), expectations);
  // @ts-expect-error intentionally testing incorrect types
  t.throws(() => new DecompressionStream("invalid"), expectations);
});
