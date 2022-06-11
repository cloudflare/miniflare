// Types adapted from https://github.com/MattiasBuelens/web-streams-polyfill/
//
// The MIT License (MIT)
//
// Copyright (c) 2020 Mattias Buelens
// Copyright (c) 2016 Diwank Singh Tomer
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

declare module "stream/web" {
  interface ReadableStream<R = any> {
    values(options?: { preventCancel?: boolean }): AsyncIterableIterator<R>;
    getReader(): ReadableStreamDefaultReader<R>;
    getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
  }

  interface ReadableStreamBYOBReader {
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<undefined>;
    read<T extends ArrayBufferView>(
      view: T
    ): Promise<ReadableStreamBYOBReadResult<T>>;
    releaseLock(): void;
    // Non-standard: https://community.cloudflare.com/t/2021-10-21-workers-runtime-release-notes/318571
    readAtLeast<T extends ArrayBufferView>(
      bytes: number,
      view: T
    ): Promise<ReadableStreamBYOBReadResult<T>>;
  }

  export type ReadableStreamBYOBReadResult<T extends ArrayBufferView> =
    | {
        done: false;
        value: T;
      }
    | {
        done: true;
        value: T | undefined;
      };

  class CompressionStream extends TransformStream {
    constructor(format: "gzip" | "deflate");
  }
  class DecompressionStream extends TransformStream {
    constructor(format: "gzip" | "deflate");
  }
}
