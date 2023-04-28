import { text } from "stream/consumers";
import { ReadableStream } from "stream/web";
import { _RemoveTransformEncodingChunkedStream } from "@miniflare/tre";
import test from "ava";
import { utf8Encode } from "../../test-shared";

function createChunkedStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(utf8Encode(chunk));
      }
    },
  });
}

test('_RemoveTransformEncodingChunkedStream: removes "Transfer-Encoding: chunked" header', async (t) => {
  // Check with `Transfer-Encoding: chunked` as last header
  let chunks = [
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/plain\r",
    "\nTransfer-Encoding: chunked\r\n",
    "\r\nabc",
    "def",
    "ghi",
  ];
  let remover = new _RemoveTransformEncodingChunkedStream();
  let output = await text(createChunkedStream(chunks).pipeThrough(remover));
  t.is(output, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nabcdefghi");

  // Check with `Transfer-Encoding: chunked` split over multiple chunks
  chunks = [
    "HTTP/1.1 200 OK\r\n",
    "Transfer-",
    "Encoding: chun",
    "ked\r",
    "\nContent-Type: text/html\r",
    "\n\r\nabc",
    "def",
    "ghi",
  ];
  remover = new _RemoveTransformEncodingChunkedStream();
  output = await text(createChunkedStream(chunks).pipeThrough(remover));
  t.is(output, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nabcdefghi");

  // Check without `Transfer-Encoding: chunked`
  chunks = [
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/xml\r\n\r\n",
    "abc",
    "def",
    "ghi",
  ];
  remover = new _RemoveTransformEncodingChunkedStream();
  output = await text(createChunkedStream(chunks).pipeThrough(remover));
  t.is(output, "HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\nabcdefghi");

  // Check with end-of-headers split over multiple chunks
  chunks = [
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/plain\r",
    "\nTransfer-Encoding: chunked\r",
    "\n\r",
    "\nabc",
    "def",
    "ghi",
  ];
  remover = new _RemoveTransformEncodingChunkedStream();
  output = await text(createChunkedStream(chunks).pipeThrough(remover));
  t.is(output, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nabcdefghi");

  // Check without end-of-headers (this shouldn't ever happen)
  chunks = [
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/plain\r",
    "\nTransfer-Encoding: chunked\r\n",
  ];
  remover = new _RemoveTransformEncodingChunkedStream();
  output = await text(createChunkedStream(chunks).pipeThrough(remover));
  t.is(
    output,
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n"
  );
});
