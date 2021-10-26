import assert from "assert";
import {
  ReadableByteStream,
  ReadableStream,
  ReadableStreamBYOBReadResult,
} from "stream/web";
import { ArrayBufferViewConstructor } from "@miniflare/core";
import test from "ava";

import "@miniflare/core";

function chunkedStream(chunks: number[][]): ReadableByteStream {
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
  stream: ReadableByteStream,
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
