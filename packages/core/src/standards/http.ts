// noinspection SuspiciousTypeOfGuard

import assert from "assert";
import { Blob } from "buffer";
import type EventEmitter from "events";
import http from "http";
import {
  ReadableStream,
  ReadableStreamDefaultReader,
  UnderlyingByteSource,
} from "stream/web";
import { URL } from "url";
import {
  Log,
  PluginContext,
  assertInRequest,
  getRequestContext,
  nonCircularClone,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import type { WebSocket } from "@miniflare/web-sockets";
import {
  Colorize,
  blue,
  bold,
  dim,
  green,
  grey,
  red,
  yellow,
} from "kleur/colors";
import { splitCookiesString } from "set-cookie-parser";
import {
  Request as BaseRequest,
  RequestInfo as BaseRequestInfo,
  RequestInit as BaseRequestInit,
  Response as BaseResponse,
  ResponseInit as BaseResponseInit,
  BodyInit,
  Dispatcher,
  File,
  FormData,
  Headers,
  MockAgent,
  RequestRedirect,
  ResponseRedirectStatus,
  fetch as baseFetch,
  getGlobalDispatcher,
} from "undici";
import { IncomingRequestCfProperties, RequestInitCfProperties } from "./cf";
import {
  bufferSourceToArray,
  buildNotBufferSourceError,
  isBufferSource,
} from "./helpers";
import {
  _isByteStream,
  convertToRegularStream,
  kBodyStreamBrand,
  kContentLength,
} from "./streams";

// We need these for making Request's Headers immutable
const fetchSymbols: {
  readonly kState: unique symbol;
  readonly kGuard: unique symbol;
} = require("undici/lib/fetch/symbols.js");

export type {
  BodyInit,
  HeadersInit,
  RequestCache,
  RequestCredentials,
  RequestDestination,
  RequestMode,
  RequestRedirect,
  ResponseType,
  ResponseRedirectStatus,
} from "undici";
export { Headers } from "undici";

const inspect = Symbol.for("nodejs.util.inspect.custom");
const nonEnumerable = Object.create(null);
nonEnumerable.enumerable = false;

function makeEnumerable<T>(prototype: any, instance: T, keys: (keyof T)[]) {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key)!;
    descriptor.enumerable = true;
    Object.defineProperty(instance, key, descriptor);
  }
}

function unimplemented(klass: string, property: string): never {
  throw new Error(
    `Failed to get the '${property}' property on '${klass}': the property is not implemented.`
  );
}

// Manipulating the prototype like this isn't very nice. However, this is a
// non-standard function so it's unlikely to cause problems with other people's
// code. Miniflare is also usually the only thing running in a process.
// The alternative would probably be to subclass Headers. However, we'd have
// to construct a version of our Headers object from undici Headers, which
// would copy the headers. If we then attempted to create a new Response from
// this mutated-header Response, the headers wouldn't be copied, as we unwrap
// our hybrid Response before passing it to undici.
// @ts-expect-error getAll is non-standard
Headers.prototype.getAll = function (key: string): string[] {
  if (key.toLowerCase() !== "set-cookie") {
    throw new TypeError(
      'getAll() can only be used with the header name "Set-Cookie".'
    );
  }
  const value = this.get("set-cookie");
  return value ? splitCookiesString(value) : [];
};

/** @internal */
export function _headersFromIncomingRequest(
  req: http.IncomingMessage
): Headers {
  const headers = new Headers();
  for (const [name, values] of Object.entries(req.headers)) {
    // These headers are unsupported in undici fetch requests, they're added
    // automatically
    if (
      name === "transfer-encoding" ||
      name === "connection" ||
      name === "keep-alive" ||
      name === "expect"
    ) {
      continue;
    }
    if (Array.isArray(values)) {
      for (const value of values) headers.append(name, value);
    } else if (values !== undefined) {
      headers.append(name, values);
    }
  }
  return headers;
}

// Instead of subclassing our customised Request and Response classes from
// BaseRequest and BaseResponse, we instead compose them and implement the same
// interface.
//
// This allows us to clone them without changing the prototype (which we'd have
// to do so custom properties like cf are cloned if we clone the new cloned
// response again).
//
// It also allows us to more easily apply input gating to the body stream whilst
// still allowing it to be cloned. Internally, undici calls tee() on the actual
// `body` property, but calling pipeThrough() on the stream (to apply input
// gating) locks it, preventing the tee and the clone. We could use a Proxy to
// lazily pipeThrough() when calling getReader(), [Symbol.asyncIterator](),
// pipeTo(), or pipeThrough() on the stream, but then input gating wouldn't be
// applied if the user called tee() themselves on the `body`.
//
// Finally, it allows us to easily remove methods Workers don't implement.
/** @internal */
export const _kInner = Symbol("kInner");

const kBodyStream = Symbol("kBodyStream");
const kInputGated = Symbol("kInputGated");
const kFormDataFiles = Symbol("kFormDataFiles");
const kCloned = Symbol("kCloned");

const enumerableBodyKeys: (keyof Body<any>)[] = ["body", "bodyUsed", "headers"];
export class Body<Inner extends BaseRequest | BaseResponse> {
  /** @internal */
  [_kInner]: Inner;
  [kInputGated] = false;
  [kFormDataFiles] = true; // Default to enabling form-data File parsing
  [kCloned] = false;
  [kBodyStream]?: ReadableStream<Uint8Array>;

  constructor(inner: Inner) {
    // Allow forbidden header mutation after construction
    // @ts-expect-error internal kGuard isn't included in type definitions
    inner.headers[fetchSymbols.kGuard] = "none";

    this[_kInner] = inner;

    makeEnumerable(Body.prototype, this, enumerableBodyKeys);
    Object.defineProperty(this, _kInner, nonEnumerable);
    Object.defineProperty(this, kInputGated, nonEnumerable);
    Object.defineProperty(this, kFormDataFiles, nonEnumerable);
  }

  [inspect](): Inner {
    return this[_kInner];
  }

  get headers(): Headers {
    return this[_kInner].headers;
  }

  get body(): ReadableStream<Uint8Array> | null {
    const body = this[_kInner].body;

    if (body === null) return body;
    // Only transform body stream once
    let bodyStream = this[kBodyStream];
    if (bodyStream) return bodyStream;
    assert(body instanceof ReadableStream);

    // Cloudflare Workers allows you to byob-read all Request/Response bodies,
    // (e.g. incoming requests, user-created ones, clones, fetches, etc).
    // Therefore, we need to make sure the body is a byte stream.
    //
    // If this is an input gated body too, we also need to wait for the input
    // gate to open before delivering each chunk.

    // If we're not input gating, and body is already a byte stream, we're set,
    // just return it as is (this will be the case for incoming http requests)
    if (!this[kInputGated] && _isByteStream(body)) {
      return (this[kBodyStream] = body);
    }

    // Otherwise, we need to create a "byte-TransformStream" that makes sure
    // all chunks are BufferSources, converts them to Uint8Arrays, and waits
    // for the input gate to open before delivering each chunk if needed.
    let reader: ReadableStreamDefaultReader<unknown>;
    const source: UnderlyingByteSource = {
      type: "bytes",
      pull: async (controller) => {
        // Don't get reader until we need it (i.e. until first pull)
        if (reader === undefined) reader = body.getReader();

        // Keep reading until we get a non-empty chunk, or we're done
        let { done, value } = await reader.read();
        while (!done && isBufferSource(value) && value.byteLength === 0) {
          ({ done, value } = await reader.read());
        }

        // Before delivering the chunk, wait for the input gate if needed
        if (this[kInputGated]) await waitForOpenInputGate();

        if (isBufferSource(value)) {
          // Deliver the chunk if it's a non-empty ArrayBuffer(View)
          if (value.byteLength) {
            let array = bufferSourceToArray(value);
            // controller.enqueue() will detach array's buffer, so if we've
            // cloned this response, or this response is cloned, we must copy
            // the array to a new buffer, so the other side can still access it.
            if (this[kCloned]) array = array.slice();
            controller.enqueue(array);
          }
        } else if (value) {
          // Otherwise, if it's not an ArrayBuffer(View), throw
          return controller.error(
            new TypeError(buildNotBufferSourceError(value))
          );
        }

        // If the body is finished, close this stream too
        if (done) {
          controller.close();
          // Not documented in MDN but if there's an ongoing request that's waiting,
          // we need to tell it that there were 0 bytes delivered so that it unblocks
          // and notices the end of stream.
          // @ts-expect-error `byobRequest` has type `undefined` in `@types/node`
          controller.byobRequest?.respond(0);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    };
    // TODO: maybe set { highWaterMark: 0 } as a strategy here?
    bodyStream = new ReadableStream(source);
    Object.defineProperty(bodyStream, kBodyStreamBrand, { value: true });

    // If this body has a known content length, attach it to the body
    // https://github.com/cloudflare/miniflare/issues/522
    // (note `parseInt(null)` is `NaN`)
    const maybeContentLength = parseInt(this.headers.get("Content-Length")!);
    if (!isNaN(maybeContentLength)) {
      Object.defineProperty(bodyStream, kContentLength, {
        value: maybeContentLength,
      });
    }

    return (this[kBodyStream] = bodyStream);
  }
  get bodyUsed(): boolean {
    return this[_kInner].bodyUsed;
  }

  // TODO: we probably need to check chunks are BufferSource's for these
  //  consumers too

  async arrayBuffer(): Promise<ArrayBuffer> {
    const body = await this[_kInner].arrayBuffer();
    if (this[kInputGated]) await waitForOpenInputGate();
    return body;
  }
  async blob(): Promise<Blob> {
    const body = await this[_kInner].blob();
    if (this[kInputGated]) await waitForOpenInputGate();
    return body;
  }
  async formData(): Promise<FormData> {
    // undici doesn't include a multipart/form-data parser yet, so we parse
    // form data with busboy instead
    const headers: http.IncomingHttpHeaders = {};
    for (const [key, value] of this.headers) headers[key.toLowerCase()] = value;
    if (headers["content-type"] === undefined) {
      throw new TypeError(
        "Parsing a Body as FormData requires a Content-Type header."
      );
    }
    const formData = new FormData();
    await new Promise<void>(async (resolve, reject) => {
      try {
        const Busboy: typeof import("busboy") = require("busboy");
        const busboy = Busboy({
          headers: headers as http.IncomingHttpHeaders,
          preservePath: true,
        });
        busboy.on("field", (name, value) => {
          formData.append(name, value);
        });
        busboy.on("file", (name, value, info) => {
          const { filename, encoding, mimeType } = info;
          const base64 = encoding.toLowerCase() === "base64";
          const chunks: Buffer[] = [];
          let totalLength = 0;
          value.on("data", (chunk: Buffer) => {
            if (base64) chunk = Buffer.from(chunk.toString(), "base64");
            chunks.push(chunk);
            totalLength += chunk.byteLength;
          });
          value.on("end", () => {
            if (this[kFormDataFiles]) {
              const file = new File(chunks, filename, { type: mimeType });
              formData.append(name, file);
            } else {
              const text = Buffer.concat(chunks, totalLength).toString();
              formData.append(name, text);
            }
          });
        });
        busboy.on("finish", resolve);

        const body = this[_kInner].body;
        if (body !== null) for await (const chunk of body) busboy.write(chunk);
        busboy.end();
      } catch (e) {
        reject(new TypeError(e instanceof Error ? e.message : String(e)));
      }
    });
    if (this[kInputGated]) await waitForOpenInputGate();
    return formData;
  }
  async json<T>(): Promise<T> {
    const body = await this[_kInner].json();
    if (this[kInputGated]) await waitForOpenInputGate();
    return body as T;
  }
  async text(): Promise<string> {
    const body = await this[_kInner].text();
    if (this[kInputGated]) await waitForOpenInputGate();
    return body;
  }
}

export function withInputGating<Inner extends Body<BaseRequest | BaseResponse>>(
  body: Inner
): Inner {
  body[kInputGated] = true;
  return body;
}

export function withStringFormDataFiles<
  Inner extends Body<BaseRequest | BaseResponse>
>(body: Inner): Inner {
  body[kFormDataFiles] = false;
  return body;
}

/** @internal */
export function _isBodyStream(stream: ReadableStream): boolean {
  return (
    (stream as { [kBodyStreamBrand]?: unknown })[kBodyStreamBrand] === true
  );
}

export type RequestInfo = BaseRequestInfo | Request;

export interface RequestInit extends BaseRequestInit {
  cf?: IncomingRequestCfProperties | RequestInitCfProperties;
}

const enumerableRequestKeys: (keyof Request)[] = [
  "cf",
  "signal",
  "redirect",
  "url",
  "method",
];

// These keys aren't marked enumerable on `BaseRequest`, so we can't use
// `{...req}` to clone the init object. Instead, we use `in` checks and copy
// them over if present.
const requestInitKeys: (keyof RequestInit)[] = [
  "method",
  "keepalive",
  "headers",
  "body",
  "redirect",
  "integrity",
  "signal",
  "credentials",
  "mode",
  "referrer",
  "referrerPolicy",
  "window",
  "dispatcher",
  "duplex",
];
function cloneRequestInit(init: RequestInit): RequestInit {
  const result: RequestInit = {};
  for (const key of requestInitKeys) {
    if (key in init) (result as Record<string, unknown>)[key] = init[key];
  }
  return result;
}

export class Request extends Body<BaseRequest> {
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #cf?: IncomingRequestCfProperties | RequestInitCfProperties;

  constructor(input: RequestInfo, init?: RequestInit) {
    // If body is a FixedLengthStream, set Content-Length to its expected
    // length. We may replace `init.body` later on with a different stream, so
    // extract `contentLength` now.
    const contentLength: number | undefined = (
      init?.body as { [kContentLength]?: number }
    )?.[kContentLength];

    const cf = input instanceof Request ? init?.cf ?? input.#cf : init?.cf;
    if (input instanceof BaseRequest && !init) {
      // For cloning
      super(input);
    } else {
      // Don't pass our strange hybrid Request to undici
      if (input instanceof Request) input = input[_kInner];
      if (init instanceof Request) init = init[_kInner] as RequestInit;
      // We may mutate some `init` properties below, make sure these aren't
      // visible to the caller
      init = init ? cloneRequestInit(init) : undefined;
      // If body is an ArrayBuffer, clone it, so it doesn't get detached when
      // enqueuing the chunk to the body stream
      if (init?.body instanceof ArrayBuffer) {
        init.body = init.body.slice(0);
      }
      if (init?.body instanceof ReadableStream) {
        init.duplex = "half";
        if (_isByteStream(init.body)) {
          // Since `undici@5.12.0`, cloning a body now invokes `structuredClone`
          // on the underlying stream (https://github.com/nodejs/undici/pull/1697).
          // Unfortunately, due to a bug in Node, byte streams cannot be
          // `structuredClone`d (https://github.com/nodejs/undici/issues/1873,
          // https://github.com/nodejs/node/pull/45955), leading to issues when
          // attempting to clone incoming requests.
          init.body = convertToRegularStream(init.body);
        }
      }
      super(new BaseRequest(input, init));
    }
    this.#cf = cf ? nonCircularClone(cf) : undefined;

    if (contentLength !== undefined) {
      this.headers.set("content-length", contentLength.toString());
    }

    makeEnumerable(Request.prototype, this, enumerableRequestKeys);
  }

  clone(): Request {
    const innerClone = this[_kInner].clone();
    this[kBodyStream] = undefined;
    const clone = new Request(innerClone);
    clone[kInputGated] = this[kInputGated];
    clone[kFormDataFiles] = this[kFormDataFiles];
    // @ts-expect-error internal kGuard isn't included in type definitions
    clone.headers[fetchSymbols.kGuard] = this.headers[fetchSymbols.kGuard];
    clone.#cf = this.cf ? nonCircularClone(this.cf) : undefined;

    // Mark both this and the new request as cloned, so we copy array buffers
    // before detaching them by enqueuing to a byte stream controller
    this[kCloned] = true;
    clone[kCloned] = true;

    return clone;
  }

  // Pass-through standard properties
  get method(): string {
    return this[_kInner].method;
  }
  get url(): string {
    return this[_kInner].url;
  }
  get redirect(): RequestRedirect {
    return this[_kInner].redirect;
  }
  get signal(): AbortSignal {
    return this[_kInner].signal;
  }
  get cf(): IncomingRequestCfProperties | RequestInitCfProperties | undefined {
    return this.#cf;
  }

  // Unimplemented properties
  get context(): never {
    return unimplemented("Request", "context");
  }
  get mode(): never {
    return unimplemented("Request", "mode");
  }
  get credentials(): never {
    return unimplemented("Request", "credentials");
  }
  get integrity(): never {
    return unimplemented("Request", "integrity");
  }
  get cache(): never {
    return unimplemented("Request", "cache");
  }
}

export function withImmutableHeaders<Body extends Request | Response>(
  body: Body
): Body {
  // @ts-expect-error internal kGuard isn't included in type definitions
  body.headers[fetchSymbols.kGuard] = "immutable";
  return body;
}

export interface ResponseInit extends BaseResponseInit {
  readonly encodeBody?: "automatic" | "manual";
  readonly webSocket?: WebSocket;
}

const kWaitUntil = Symbol("kWaitUntil");

// From https://github.com/nodejs/undici/blob/3f6b564b7d3023d506cad75b16207006b23956a8/lib/fetch/constants.js#L28
// https://fetch.spec.whatwg.org/#null-body-status
const nullBodyStatus: (number | undefined)[] = [101, 204, 205, 304];

const enumerableResponseKeys: (keyof Response)[] = [
  "webSocket",
  "url",
  "redirected",
  "ok",
  "statusText",
  "status",
];
export class Response<
  WaitUntil extends any[] = unknown[]
> extends Body<BaseResponse> {
  // Note Workers don't implement Response.error()

  static redirect(
    url: string | URL,
    status: ResponseRedirectStatus = 302
  ): Response {
    const res = BaseResponse.redirect(url, status);
    return new Response(res.body, res);
  }

  static json(data: any, init?: ResponseInit): Response {
    const res = BaseResponse.json(data, init);
    return new Response(res.body, res);
  }

  // https://developers.cloudflare.com/workers/runtime-apis/response#properties
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #encodeBody: "automatic" | "manual";
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #status?: number;
  readonly #webSocket?: WebSocket;
  [kWaitUntil]?: Promise<WaitUntil>;

  constructor(body?: BodyInit, init?: ResponseInit | Response | BaseResponse) {
    // If body is a FixedLengthStream, set Content-Length to its expected
    // length. We may replace `body` later on with a different stream, so
    // extract `contentLength` now.
    const contentLength: number | undefined = (
      body as { [kContentLength]?: number }
    )?.[kContentLength];

    let encodeBody: string | undefined;
    let status: number | undefined;
    let webSocket: WebSocket | undefined;
    if (init instanceof BaseResponse && body === init.body) {
      // For cloning
      super(init);
    } else {
      // If body is an ArrayBuffer, clone it, so it doesn't get detached when
      // enqueuing the chunk to the body stream
      if (body instanceof ArrayBuffer) {
        body = body.slice(0);
      }
      if (body instanceof ReadableStream && _isByteStream(body)) {
        // Since `undici@5.12.0`, cloning a body now invokes `structuredClone`
        // on the underlying stream (https://github.com/nodejs/undici/pull/1697).
        // Unfortunately, due to a bug in Node, byte streams cannot be
        // `structuredClone`d (https://github.com/nodejs/undici/issues/1873,
        // https://github.com/nodejs/node/pull/45955), leading to issues when
        // constructing bodies with byte streams.
        body = convertToRegularStream(body);
      }

      if (init instanceof Response) {
        encodeBody = init.#encodeBody;
        // No need to check status here, will have been validated when
        // constructing response in the first place
        status = init.#status;
        webSocket = init.#webSocket;
        // Don't pass our strange hybrid Response to undici
        init = init[_kInner];
      } else if (!(init instanceof BaseResponse) /* ResponseInit */ && init) {
        encodeBody = init.encodeBody;

        // Status 101 Switching Protocols would normally throw a RangeError, but we
        // need to allow it for WebSockets
        if (init.webSocket) {
          if (init.status !== 101) {
            throw new RangeError(
              "Responses with a WebSocket must have status code 101."
            );
          }
          status = init.status;
          webSocket = init.webSocket;
          init = { ...init, status: 200 };
        }

        // If a null-body status has been passed, and body is the empty string,
        // set it to null. Undici will correctly complain if we don't do this.
        //
        // This zero-length body behavior is allowed because it was previously
        // the only way to construct a Response with a null body status. It may
        // change in the future.
        if (nullBodyStatus.includes(init.status) && body === "") body = null;
      }

      super(new BaseResponse(body, init));
    }

    encodeBody ??= "automatic";
    if (encodeBody !== "automatic" && encodeBody !== "manual") {
      throw new TypeError(`encodeBody: unexpected value: ${encodeBody}`);
    }
    this.#encodeBody = encodeBody;

    this.#status = status;
    this.#webSocket = webSocket;

    if (contentLength !== undefined) {
      this.headers.set("content-length", contentLength.toString());
    }

    makeEnumerable(Response.prototype, this, enumerableResponseKeys);
    Object.defineProperty(this, kWaitUntil, nonEnumerable);
  }

  clone(): Response {
    if (this.#webSocket) {
      throw new TypeError("Cannot clone a response to a WebSocket handshake.");
    }
    const innerClone = this[_kInner].clone();
    this[kBodyStream] = undefined;
    const clone = new Response(innerClone.body, innerClone);
    clone[kInputGated] = this[kInputGated];
    clone[kFormDataFiles] = this[kFormDataFiles];
    clone.#encodeBody = this.#encodeBody;
    // Technically don't need to copy status, as it should only be set for
    // WebSocket handshake responses
    clone.#status = this.#status;
    clone[kWaitUntil] = this[kWaitUntil];

    // Mark both this and the new response as cloned, so we copy array buffers
    // before detaching them by enqueuing to a byte stream controller
    this[kCloned] = true;
    clone[kCloned] = true;

    return clone;
  }

  get encodeBody(): "automatic" | "manual" {
    return this.#encodeBody;
  }
  get webSocket(): WebSocket | undefined {
    return this.#webSocket;
  }

  waitUntil(): Promise<WaitUntil> {
    return this[kWaitUntil] ?? Promise.resolve([] as unknown as WaitUntil);
  }

  // Pass-through standard properties
  get status(): number {
    return this.#status ?? this[_kInner].status;
  }
  get statusText(): string {
    return this[_kInner].statusText;
  }
  get ok(): boolean {
    return this[_kInner].ok;
  }
  get redirected(): boolean {
    return this[_kInner].redirected;
  }
  get url(): string {
    return this[_kInner].url;
  }

  // Unimplemented properties
  get type(): never {
    return unimplemented("Response", "type");
  }
  get useFinalUrl(): never {
    return unimplemented("Response", "useFinalUrl");
  }
}

export function withWaitUntil<WaitUntil extends any[]>(
  res: Response | BaseResponse,
  waitUntil: Promise<WaitUntil>
): Response<WaitUntil> {
  const resWaitUntil: Response<WaitUntil> =
    res instanceof Response
      ? (res as Response<WaitUntil>)
      : new Response(res.body, res);
  resWaitUntil[kWaitUntil] = waitUntil;
  return resWaitUntil;
}

/** @internal */
export function _getURLList(res: BaseResponse): URL[] | undefined {
  // Extract the internal urlList property on Responses. It doesn't matter
  // too much if the internal representation changes in the future: this code
  // shouldn't throw. Currently we use this to count the number of redirects,
  // and increment the subrequest count accordingly.
  // @ts-expect-error symbol properties are not included in type definitions
  return res[fetchSymbols.kState]?.urlList;
}

/** @internal */
export function _getBodyLength(
  res: Response | BaseResponse
): number | undefined {
  // Extract the actual body length of the Response body. Cloudflare will return
  // this for the Content-Length header instead of the user specified value
  // if its set. When the body is a stream, it's the user's responsibility to
  // set the Content-Length header if they want to.
  if (res instanceof Response) res = res[_kInner];
  // @ts-expect-error symbol properties are not included in type definitions
  return res[fetchSymbols.kState]?.body?.length ?? undefined; // (normalise nullish to undefined)
}

/** @internal */
export const _kLoopHeader = "MF-Loop";

// undici's fetch includes these headers by default, but Cloudflare's doesn't,
// so if the user doesn't explicitly include them, we'll remove them in our
// custom MiniflareDispatcher
//
// See https://github.com/cloudflare/miniflare/issues/139
const kDefaultHeadersToRemove = [
  "accept",
  "accept-language",
  "sec-fetch-mode",
  "user-agent",
];

const methodsExpectingPayload = ["PUT", "POST", "PATCH"];

class MiniflareDispatcher extends Dispatcher {
  // dispatch, close & destroy are the only methods a Dispatcher must implement:
  // https://github.com/nodejs/undici/blob/09059fb491b4158a25981eb5598262b43a18c6ae/lib/dispatcher.js

  constructor(
    private readonly inner: Dispatcher,
    private readonly removeHeaders: string[],
    // EventEmitterOptions isn't exported by the "events" module
    options?: ConstructorParameters<typeof EventEmitter>[0]
  ) {
    super(options);
  }

  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandlers
  ): boolean {
    // Remove any default fetch headers that the user didn't explicitly set,
    // `headers` has the form `["key1", "value1", "key2", "value2", ...]`
    const headers = options.headers;
    if (Array.isArray(headers)) {
      let i = 0;
      while (i < headers.length) {
        if (this.removeHeaders.includes(headers[i].toLowerCase())) {
          headers.splice(i, 2);
        } else {
          i += 2;
        }
      }
    } else if (headers != null) {
      for (const key in headers) {
        if (this.removeHeaders.includes(key.toLowerCase())) delete headers[key];
      }
    }
    return this.inner.dispatch(options, handler);
  }

  close(...args: any[]) {
    // @ts-expect-error just want to pass through to global dispatcher here
    return this.inner.close(...args);
  }

  destroy(...args: any[]) {
    // @ts-expect-error just want to pass through to global dispatcher here
    return this.inner.destroy(...args);
  }

  /**
   * Required for some testing utilities.
   * For context see: https://github.com/nodejs/undici/issues/1756#issuecomment-1304711596
   */
  get isMockActive(): boolean {
    // @ts-expect-error Missing type on MockAgent, but exists at runtime
    return this.inner.isMockActive ?? false;
  }
}

export async function fetch(
  this: Dispatcher | unknown,
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  // TODO (someday): support cache using fetch (could add to request context?):
  //  https://developers.cloudflare.com/workers/learning/how-the-cache-works#fetch
  //  https://developers.cloudflare.com/workers/examples/cache-using-fetch

  const ctx = getRequestContext();
  ctx?.incrementExternalSubrequests();

  await waitForOpenOutputGate();

  // Set the headers guard to "none" so we can delete the "Host" header
  const req = new Request(input, init);
  // @ts-expect-error internal kGuard isn't included in type definitions
  req.headers[fetchSymbols.kGuard] = "none";
  // Delete the "Host" header, the correct value will be added by undici
  req.headers.delete("host");
  // Delete the "CF-Connecting-IP" header, if we didn't do this, we'd get a 403
  // response when attempting to make requests to sites behind Cloudflare
  req.headers.delete("cf-connecting-ip");
  // Add "MF-Loop" header for loop detection
  req.headers.set(_kLoopHeader, String(ctx?.requestDepth ?? 1));
  // Delete "content-length: 0" from bodyless requests. Some proxies add this,
  // but undici considers it an error.
  // See https://github.com/cloudflare/miniflare/issues/193
  if (
    !methodsExpectingPayload.includes(req.method) &&
    req.headers.get("content-length") === "0"
  ) {
    req.headers.delete("content-length");
  }

  // Mark default headers for removal that aren't explicitly included
  const removeHeaders: string[] = [];
  for (const header of kDefaultHeadersToRemove) {
    if (!req.headers.has(header)) removeHeaders.push(header);
  }

  // TODO: instead of using getGlobalDispatcher() here, we could allow a custom
  //  one to be passed for easy mocking
  const dispatcher = new MiniflareDispatcher(
    this instanceof Dispatcher ? this : getGlobalDispatcher(),
    removeHeaders
  );
  // Don't pass our strange hybrid Request to undici
  const baseRes = await baseFetch(req[_kInner], { dispatcher });

  // Increment the subrequest count by the number of redirects
  // TODO (someday): technically we should check the subrequest count before
  //  each redirect, so requests don't actually get sent to the server if the
  //  subrequest count exceeds the limit
  if (baseRes.redirected && ctx) {
    const urlList = _getURLList(baseRes);
    // Last url is final destination, so subtract 1 for redirect count
    if (urlList) ctx.incrementExternalSubrequests(urlList.length - 1);
  }

  // Convert the response to our hybrid Response
  const res = new Response(
    // https://fetch.spec.whatwg.org/#null-body-status
    nullBodyStatus.includes(baseRes.status) ? null : baseRes.body,
    baseRes
  );
  // @ts-expect-error internal kGuard isn't included in type definitions
  res.headers[fetchSymbols.kGuard] = "immutable";

  await waitForOpenInputGate();
  ctx?.advanceCurrentTime();
  return withInputGating(res);
}

export function createFetchMock() {
  return new MockAgent();
}

/** @internal */
export function _urlFromRequestInput(input: RequestInfo): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request || input instanceof BaseRequest) {
    return new URL(input.url);
  }
  return new URL(input);
}

/** @internal */
export function _buildUnknownProtocolWarning(url: URL): string {
  let warning =
    "Worker passed an invalid URL to fetch(). URLs passed to fetch() " +
    "must begin with either 'http:' or 'https:', not '" +
    url.protocol +
    "'. Due to a historical bug, any other protocol used here will " +
    "be treated the same as 'http:'. We plan to correct this bug in " +
    "the future, so please update your Worker to use 'http:' or " +
    "'https:' for all fetch() URLs.";
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    warning +=
      " Note that fetch() treats WebSockets as a special kind of HTTP " +
      "request, therefore WebSockets should use 'http:'/'https:', not " +
      "'ws:'/'wss:'.";
  }
  return warning;
}

export function createCompatFetch(
  {
    log,
    compat,
    globalAsyncIO,
  }: Pick<PluginContext, "log" | "compat" | "globalAsyncIO">,
  inner: typeof fetch = fetch
): typeof fetch {
  const refusesUnknown = compat.isEnabled("fetch_refuses_unknown_protocols");
  const formDataFiles = compat.isEnabled("formdata_parser_supports_files");
  return async (input, init) => {
    // We do this check in `createCompatFetch` so people can still use regular
    // `fetch` in tests which would be outside a request context
    if (!globalAsyncIO) assertInRequest();

    const url = _urlFromRequestInput(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      if (refusesUnknown) {
        throw new TypeError(`Fetch API cannot load: ${url.toString()}`);
      } else {
        log.warn(_buildUnknownProtocolWarning(url));

        // Make sure we don't lose any data when we override input
        if (init) {
          init = new Request(input, init);
        } else if (input instanceof BaseRequest) {
          // BaseRequest's properties aren't enumerable, so convert to a Request
          init = new Request(input);
        } else if (input instanceof Request) {
          init = input;
        }

        // If url.protocol is not a special scheme, it cannot be changed to a
        // special scheme (e.g. "http:"), so we can't just do
        // `url.protocol = "http:"` here.
        //
        // See https://nodejs.org/api/url.html#special-schemes
        input = url.toString().replace(url.protocol, "http:");
      }
    }
    let res = await inner(input, init);
    if (!formDataFiles) res = withStringFormDataFiles(res);
    return res;
  };
}

export type HRTime = [seconds: number, nanoseconds: number];

function millisFromHRTime([seconds, nanoseconds]: HRTime): string {
  return `${((seconds * 1e9 + nanoseconds) / 1e6).toFixed(2)}ms`;
}

function millisFromCPUTime(microseconds: number): string {
  return `${(microseconds / 1e3).toFixed(2)}ms`;
}

function colourFromHTTPStatus(status: number): Colorize {
  if (200 <= status && status < 300) return green;
  if (400 <= status && status < 500) return yellow;
  if (500 <= status) return red;
  return blue;
}

export async function logResponse(
  log: Log,
  {
    start,
    startCpu,
    method,
    url,
    status,
    waitUntil,
  }: {
    start: HRTime;
    startCpu?: NodeJS.CpuUsage;
    method: string;
    url: string;
    status?: number;
    waitUntil?: Promise<any[]>;
  }
): Promise<void> {
  const cpuParts: string[] = [];

  const responseTime = millisFromHRTime(process.hrtime(start));
  if (startCpu !== undefined) {
    const responseTimeCpu = millisFromCPUTime(process.cpuUsage(startCpu).user);
    cpuParts.push(dim(grey(` (CPU: ~${responseTimeCpu}`)));
  }

  // Wait for all waitUntil promises to resolve
  let waitUntilResponse: any[] | undefined;
  try {
    waitUntilResponse = await waitUntil;
  } catch (e: any) {
    // Create dummy waitUntilResponse so waitUntil time shown in log
    waitUntilResponse = [""];
    log.error(e);
  }
  const waitUntilTime = millisFromHRTime(process.hrtime(start));
  if (startCpu !== undefined) {
    if (waitUntilResponse?.length) {
      const waitUntilTimeCpu = millisFromCPUTime(
        process.cpuUsage(startCpu).user
      );
      cpuParts.push(dim(grey(`, waitUntil: ~${waitUntilTimeCpu}`)));
    }
    cpuParts.push(dim(grey(")")));
  }

  log.log(
    [
      `${bold(method)} ${url} `,
      status
        ? colourFromHTTPStatus(status)(
            `${bold(status)} ${http.STATUS_CODES[status]} `
          )
        : "",
      grey(`(${responseTime}`),
      // Only include waitUntilTime if there were waitUntil promises
      waitUntilResponse?.length ? grey(`, waitUntil: ${waitUntilTime}`) : "",
      grey(")"),
      ...cpuParts,
    ].join("")
  );
}
