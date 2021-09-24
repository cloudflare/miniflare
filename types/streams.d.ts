/* eslint-disable @typescript-eslint/explicit-module-boundary-types,@typescript-eslint/no-explicit-any */
// noinspection JSUnusedGlobalSymbols

declare module "stream/web" {
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

  export class ByteLengthQueuingStrategy
    implements QueuingStrategy<ArrayBufferView>
  {
    constructor(options: QueuingStrategyInit);
    readonly highWaterMark: number;
    readonly size: (chunk: ArrayBufferView) => number;
  }

  export class CountQueuingStrategy implements QueuingStrategy {
    constructor(options: QueuingStrategyInit);
    readonly highWaterMark: number;
    readonly size: (chunk: any) => 1;
  }

  export interface QueuingStrategy<T = any> {
    highWaterMark?: number;
    size?: QueuingStrategySizeCallback<T>;
  }

  export interface QueuingStrategyInit {
    highWaterMark: number;
  }

  type QueuingStrategySizeCallback<T = any> = (chunk: T) => number;

  type ReadableByteStream = ReadableStream<Uint8Array>;

  export class ReadableByteStreamController {
    private constructor();
    readonly byobRequest: ReadableStreamBYOBRequest | null;
    readonly desiredSize: number | null;
    close(): void;
    enqueue(chunk: ArrayBufferView): void;
    error(e?: any): void;
  }

  export class ReadableStream<R = any> {
    constructor(
      underlyingSource: UnderlyingByteSource,
      strategy?: {
        highWaterMark?: number;
        size?: undefined;
      }
    );
    constructor(
      underlyingSource?: UnderlyingSource<R>,
      strategy?: QueuingStrategy<R>
    );
    readonly locked: boolean;
    cancel(reason?: any): Promise<undefined>;
    getReader({ mode }: { mode: "byob" }): ReadableStreamBYOBReader;
    getReader(): ReadableStreamDefaultReader<R>;
    pipeThrough<T>(
      transform: ReadableWritablePair<T, R>,
      options?: StreamPipeOptions
    ): ReadableStream<T>;
    pipeTo(
      destination: WritableStream<R>,
      options?: StreamPipeOptions
    ): Promise<undefined>;
    tee(): [ReadableStream<R>, ReadableStream<R>];
    values(options?: ReadableStreamIteratorOptions): AsyncIterator<R>;
    [Symbol.asyncIterator]: (
      options?: ReadableStreamIteratorOptions
    ) => AsyncIterator<R>;
  }

  export class ReadableStreamBYOBReader {
    constructor(stream: ReadableByteStream);
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<undefined>;
    read<T extends ArrayBufferView>(
      view: T
    ): Promise<ReadableStreamBYOBReadResult<T>>;
    releaseLock(): void;
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

  export class ReadableStreamBYOBRequest {
    private constructor();
    readonly view: ArrayBufferView | null;
    respond(bytesWritten: number): void;
    respondWithNewView(view: ArrayBufferView): void;
  }

  export class ReadableStreamDefaultController<R> {
    private constructor();
    readonly desiredSize: number | null;
    close(): void;
    enqueue(chunk: R): void;
    error(e?: any): void;
  }

  export class ReadableStreamDefaultReader<R = any> {
    constructor(stream: ReadableStream<R>);
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<undefined>;
    read(): Promise<ReadableStreamDefaultReadResult<R>>;
    releaseLock(): void;
  }

  export type ReadableStreamDefaultReadResult<T> =
    | {
        done: false;
        value: T;
      }
    | {
        done: true;
        value: undefined;
      };

  export interface ReadableStreamIteratorOptions {
    preventCancel?: boolean;
  }

  export interface ReadableWritablePair<R, W> {
    readable: ReadableStream<R>;
    writable: WritableStream<W>;
  }

  export interface StreamPipeOptions {
    preventAbort?: boolean;
    preventCancel?: boolean;
    preventClose?: boolean;
    signal?: AbortSignal;
  }

  export interface Transformer<I = any, O = any> {
    start?: TransformerStartCallback<O>;
    transform?: TransformerTransformCallback<I, O>;
    flush?: TransformerFlushCallback<O>;
    readableType?: undefined;
    writableType?: undefined;
  }

  export type TransformerFlushCallback<O> = (
    controller: TransformStreamDefaultController<O>
  ) => void | PromiseLike<void>;

  export type TransformerStartCallback<O> = (
    controller: TransformStreamDefaultController<O>
  ) => void | PromiseLike<void>;

  export type TransformerTransformCallback<I, O> = (
    chunk: I,
    controller: TransformStreamDefaultController<O>
  ) => void | PromiseLike<void>;

  export class TransformStream<I = any, O = any> {
    constructor(
      transformer?: Transformer<I, O>,
      writableStrategy?: QueuingStrategy<I>,
      readableStrategy?: QueuingStrategy<O>
    );
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }

  export class TransformStreamDefaultController<O> {
    private constructor();
    readonly desiredSize: number | null;
    enqueue(chunk: O): void;
    error(reason?: any): void;
    terminate(): void;
  }

  export interface UnderlyingByteSource {
    start?: UnderlyingByteSourceStartCallback;
    pull?: UnderlyingByteSourcePullCallback;
    cancel?: UnderlyingSourceCancelCallback;
    type: "bytes";
    autoAllocateChunkSize?: number;
  }

  export type UnderlyingByteSourcePullCallback = (
    controller: ReadableByteStreamController
  ) => void | PromiseLike<void>;

  export type UnderlyingByteSourceStartCallback = (
    controller: ReadableByteStreamController
  ) => void | PromiseLike<void>;

  export interface UnderlyingSink<W = any> {
    start?: UnderlyingSinkStartCallback;
    write?: UnderlyingSinkWriteCallback<W>;
    close?: UnderlyingSinkCloseCallback;
    abort?: UnderlyingSinkAbortCallback;
    type?: undefined;
  }

  export type UnderlyingSinkAbortCallback = (
    reason: any
  ) => void | PromiseLike<void>;

  export type UnderlyingSinkCloseCallback = () => void | PromiseLike<void>;

  export type UnderlyingSinkStartCallback = (
    controller: WritableStreamDefaultController
  ) => void | PromiseLike<void>;

  export type UnderlyingSinkWriteCallback<W> = (
    chunk: W,
    controller: WritableStreamDefaultController
  ) => void | PromiseLike<void>;

  export interface UnderlyingSource<R = any> {
    start?: UnderlyingSourceStartCallback<R>;
    pull?: UnderlyingSourcePullCallback<R>;
    cancel?: UnderlyingSourceCancelCallback;
    type?: undefined;
  }

  export type UnderlyingSourceCancelCallback = (
    reason: any
  ) => void | PromiseLike<void>;

  export type UnderlyingSourcePullCallback<R> = (
    controller: ReadableStreamDefaultController<R>
  ) => void | PromiseLike<void>;

  export type UnderlyingSourceStartCallback<R> = (
    controller: ReadableStreamDefaultController<R>
  ) => void | PromiseLike<void>;

  export class WritableStream<W = any> {
    constructor(
      underlyingSink?: UnderlyingSink<W>,
      strategy?: QueuingStrategy<W>
    );
    readonly locked: boolean;
    abort(reason?: any): Promise<undefined>;
    close(): Promise<undefined>;
    getWriter(): WritableStreamDefaultWriter<W>;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export class WritableStreamDefaultController<W = any> {
    private constructor();
    readonly abortReason: any;
    readonly signal: AbortSignal;
    error(e?: any): void;
  }

  export class WritableStreamDefaultWriter<W = any> {
    constructor(stream: WritableStream<W>);
    readonly closed: Promise<undefined>;
    readonly desiredSize: number | null;
    readonly ready: Promise<undefined>;
    abort(reason?: any): Promise<undefined>;
    close(): Promise<undefined>;
    releaseLock(): void;
    write(chunk: W): Promise<undefined>;
  }

  // Types adapted from: https://github.com/microsoft/TypeScript/blob/main/lib/lib.webworker.d.ts
  //
  // Copyright (c) Microsoft Corporation. All rights reserved.
  // Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  // this file except in compliance with the License. You may obtain a copy of the
  // License at http://www.apache.org/licenses/LICENSE-2.0
  //
  // THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  // KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
  // WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
  // MERCHANTABLITY OR NON-INFRINGEMENT.
  //
  // See the Apache Version 2.0 License for specific language governing permissions
  // and limitations under the License.

  export class TextEncoderStream extends TransformStream<string, Uint8Array> {
    constructor();
    readonly encoding: string;
  }

  export class TextDecoderStream extends TransformStream<BufferSource, string> {
    constructor(label?: string, options?: TextDecoderOptions);
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
  }

  export class CompressionStream extends TransformStream<
    BufferSource,
    Uint8Array
  > {
    constructor(format: string);
  }

  export class DecompressionStream extends TransformStream<
    BufferSource,
    Uint8Array
  > {
    constructor(format: string);
  }
}

declare module "stream/consumers" {
  import { Readable } from "stream";

  export function blob(
    stream: AsyncIterable<any> | ReadableStream | Readable
  ): Promise<Blob>;

  export function arrayBuffer(
    stream: AsyncIterable<any> | ReadableStream | Readable
  ): Promise<ArrayBuffer>;

  export function buffer(
    stream: AsyncIterable<any> | ReadableStream | Readable
  ): Promise<Buffer>;

  export function text(
    stream: AsyncIterable<any> | ReadableStream | Readable
  ): Promise<string>;

  export function json<T>(
    stream: AsyncIterable<any> | ReadableStream | Readable
  ): Promise<T>;
}
