declare module "stream/web" {
  interface ReadableStreamBYOBRequest {
    readonly view: Uint8Array | null;
    respond(bytesWritten: number): void;
    respondWithNewView(view: ArrayBufferView): void;
  }

  interface ReadableStream<R = any> {
    getReader(): ReadableStreamDefaultReader<R>;
    getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
  }

  interface ReadableStreamBYOBReader {
    readonly closed: Promise<void>;
    cancel(reason?: any): Promise<void>;
    read<T extends ArrayBufferView>(
      view: T
    ): Promise<ReadableStreamDefaultReadResult<T>>;
    releaseLock(): void;
  }
}

declare module "stream/consumers" {
  import { Blob } from "buffer";
  import { Readable } from "stream";

  // `@types/node`'s types for `stream/consumers` omit `AsyncIterable<any>`,
  // meaning passing `ReadableStream`s from `stream/web` fails
  type StreamLike =
    | NodeJS.ReadableStream
    | Readable
    | AsyncIterator<any>
    | AsyncIterable<any>;

  function buffer(stream: StreamLike): Promise<Buffer>;
  function text(stream: StreamLike): Promise<string>;
  function arrayBuffer(stream: StreamLike): Promise<ArrayBuffer>;
  function blob(stream: StreamLike): Promise<Blob>;
  function json(stream: StreamLike): Promise<unknown>;
}
