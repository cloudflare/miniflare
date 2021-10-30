// noinspection SuspiciousTypeOfGuard

import assert from "assert";
import { Blob } from "buffer";
import http from "http";
import { ReadableStream } from "stream/web";
import { URL } from "url";
import {
  Compatibility,
  InputGatedTransformStream,
  Log,
  nonCircularClone,
  waitForOpenInputGate,
  waitForOpenOutputGate,
} from "@miniflare/shared";
import type { WebSocket } from "@miniflare/web-sockets";
import type { BusboyHeaders } from "busboy";
import { Colorize, blue, bold, green, grey, red, yellow } from "kleur/colors";
import { splitCookiesString } from "set-cookie-parser";
import {
  Headers as BaseHeaders,
  Request as BaseRequest,
  RequestInfo as BaseRequestInfo,
  RequestInit as BaseRequestInit,
  Response as BaseResponse,
  ResponseInit as BaseResponseInit,
  BodyInit,
  File,
  FormData,
  RequestCache,
  RequestCredentials,
  RequestDestination,
  RequestMode,
  RequestRedirect,
  ResponseRedirectStatus,
  ResponseType,
  fetch as baseFetch,
} from "undici";
// @ts-expect-error we need these for making Request's Headers immutable
import fetchSymbols from "undici/lib/fetch/symbols.js";
import { IncomingRequestCfProperties, RequestInitCfProperties } from "./cf";

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

export class Headers extends BaseHeaders {
  getAll(key: string): string[] {
    if (key.toLowerCase() !== "set-cookie") {
      throw new TypeError(
        'getAll() can only be used with the header name "Set-Cookie".'
      );
    }
    const value = super.get("set-cookie");
    return value ? splitCookiesString(value) : [];
  }
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
export const kInner = Symbol("kInner");

const kInputGated = Symbol("kInputGated");
const kFormDataFiles = Symbol("kFormDataFiles");

const enumerableBodyKeys: (keyof Body<any>)[] = ["body", "bodyUsed", "headers"];
export class Body<Inner extends BaseRequest | BaseResponse> {
  [kInner]: Inner;
  [kInputGated] = false;
  [kFormDataFiles] = true; // Default to enabling form-data File parsing
  #inputGatedBody?: ReadableStream;
  #headers?: Headers;

  constructor(inner: Inner) {
    this[kInner] = inner;

    makeEnumerable(Body.prototype, this, enumerableBodyKeys);
    Object.defineProperty(this, kInner, nonEnumerable);
    Object.defineProperty(this, kInputGated, nonEnumerable);
    Object.defineProperty(this, kFormDataFiles, nonEnumerable);
  }

  [inspect](): Inner {
    return this[kInner];
  }

  get headers(): Headers {
    if (this.#headers) return this.#headers;
    const headers = new Headers(this[kInner].headers);
    // @ts-expect-error internal kGuard isn't included in type definitions
    headers[fetchSymbols.kGuard] = this[kInner].headers[fetchSymbols.kGuard];
    return (this.#headers = headers);
  }

  get body(): ReadableStream | null {
    const body = this[kInner].body;
    // @ts-expect-error ReadableStreams are basically ControlledAsyncIterables.
    if (!this[kInputGated] || body === null) return body;

    // Only proxy body once
    //  Users' Workers code will also expect ReadableStreams.
    if (this.#inputGatedBody) return this.#inputGatedBody;

    assert(body instanceof ReadableStream);
    let bodyStream: ReadableStream = body; // Keep TypeScript happy later on
    let bodyPiped = false;
    this.#inputGatedBody = new Proxy(bodyStream, {
      get(target, propertyKey: keyof ReadableStream, receiver) {
        // Only call pipeThrough once we start reading the body. This means
        // if the user just gets it (maybe to check it's not null?), but doesn't
        // read anything from it, the stream won't be locked.
        //
        // locked (and cancel, but it doesn't matter if we cancel the piped
        // stream) is the only property that doesn't read stream data.
        // The rest do: getReader, pipeThrough, pipeTo, tee, values,
        //  [Symbol.asyncIterator]
        if (
          !bodyPiped &&
          (propertyKey === Symbol.asyncIterator ||
            propertyKey === "getReader" ||
            propertyKey === "pipeThrough" ||
            propertyKey === "pipeTo" ||
            propertyKey === "tee" ||
            propertyKey === "values")
        ) {
          bodyPiped = true;
          bodyStream = bodyStream.pipeThrough(new InputGatedTransformStream());
        }
        return Reflect.get(bodyStream, propertyKey, receiver);
      },
    });
    return this.#inputGatedBody;
  }
  get bodyUsed(): boolean {
    return this[kInner].bodyUsed;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const body = await this[kInner].arrayBuffer();
    this[kInputGated] && (await waitForOpenInputGate());
    return body;
  }
  async blob(): Promise<Blob> {
    const body = await this[kInner].blob();
    this[kInputGated] && (await waitForOpenInputGate());
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
    await new Promise<void>(async (resolve) => {
      const Busboy = await import("busboy");
      const busboy = new Busboy.default({ headers: headers as BusboyHeaders });
      busboy.on("field", (name, value) => {
        formData.append(name, value);
      });
      busboy.on("file", (name, value, filename, encoding, type) => {
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
            const file = new File(chunks, filename, { type });
            formData.append(name, file);
          } else {
            const text = Buffer.concat(chunks, totalLength).toString();
            formData.append(name, text);
          }
        });
      });
      busboy.on("finish", resolve);

      const body = this[kInner].body;
      if (body !== null) for await (const chunk of body) busboy.write(chunk);
      busboy.end();
    });
    this[kInputGated] && (await waitForOpenInputGate());
    return formData;
  }
  async json<T>(): Promise<T> {
    const body = await this[kInner].json();
    this[kInputGated] && (await waitForOpenInputGate());
    return body as T;
  }
  async text(): Promise<string> {
    const body = await this[kInner].text();
    this[kInputGated] && (await waitForOpenInputGate());
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

export type RequestInfo = BaseRequestInfo | Request;

export interface RequestInit extends BaseRequestInit {
  readonly cf?: IncomingRequestCfProperties | RequestInitCfProperties;
}

const enumerableRequestKeys: (keyof Request)[] = [
  "cf",
  "signal",
  "redirect",
  "url",
  "method",
];
export class Request extends Body<BaseRequest> {
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #cf?: IncomingRequestCfProperties | RequestInitCfProperties;

  constructor(input: RequestInfo, init?: RequestInit) {
    const cf = input instanceof Request ? input.#cf : init?.cf;
    if (input instanceof BaseRequest && !init) {
      // For cloning
      super(input);
    } else {
      // Don't pass our strange hybrid Request to undici
      if (input instanceof Request) input = input[kInner];
      super(new BaseRequest(input, init));
    }
    this.#cf = cf ? nonCircularClone(cf) : undefined;

    makeEnumerable(Request.prototype, this, enumerableRequestKeys);
  }

  clone(): Request {
    const innerClone = this[kInner].clone();
    const clone = new Request(innerClone);
    clone[kInputGated] = this[kInputGated];
    clone[kFormDataFiles] = this[kFormDataFiles];
    clone.#cf = this.cf ? nonCircularClone(this.cf) : undefined;
    return clone;
  }

  get cf(): IncomingRequestCfProperties | RequestInitCfProperties | undefined {
    return this.#cf;
  }

  // Pass-through standard properties
  get cache(): RequestCache {
    return this[kInner].cache;
  }
  get credentials(): RequestCredentials {
    return this[kInner].credentials;
  }
  get destination(): RequestDestination {
    return this[kInner].destination;
  }
  get integrity(): string {
    return this[kInner].integrity;
  }
  get method(): string {
    return this[kInner].method;
  }
  get mode(): RequestMode {
    return this[kInner].mode;
  }
  get redirect(): RequestRedirect {
    return this[kInner].redirect;
  }
  get referrerPolicy(): string {
    return this[kInner].referrerPolicy;
  }
  get url(): string {
    return this[kInner].url;
  }
  get keepalive(): boolean {
    return this[kInner].keepalive;
  }
  get signal(): AbortSignal {
    return this[kInner].signal;
  }
}

export function withImmutableHeaders(req: Request): Request {
  // @ts-expect-error internal kGuard isn't included in type definitions
  req.headers[fetchSymbols.kGuard] = "immutable";
  return req;
}

export interface ResponseInit extends BaseResponseInit {
  readonly encodeBody?: "auto" | "manual";
  readonly webSocket?: WebSocket;
}

const kWaitUntil = Symbol("kWaitUntil");

const enumerableResponseKeys: (keyof Response)[] = [
  "encodeBody",
  "webSocket",
  "url",
  "redirected",
  "ok",
  "statusText",
  "status",
  "type",
];
export class Response<
  WaitUntil extends any[] = unknown[]
> extends Body<BaseResponse> {
  // Note Workers don't implement Response.error()

  static redirect(url: string | URL, status: ResponseRedirectStatus): Response {
    const res = BaseResponse.redirect(url, status);
    return new Response(res.body, res);
  }

  // https://developers.cloudflare.com/workers/runtime-apis/response#properties
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #encodeBody: "auto" | "manual";
  // noinspection TypeScriptFieldCanBeMadeReadonly
  #status?: number;
  readonly #webSocket?: WebSocket;
  [kWaitUntil]?: Promise<WaitUntil>;

  constructor(body?: BodyInit, init?: ResponseInit | Response | BaseResponse) {
    let encodeBody: string | undefined;
    let status: number | undefined;
    let webSocket: WebSocket | undefined;
    if (init instanceof BaseResponse && body === init.body) {
      // For cloning
      super(init);
    } else {
      if (init instanceof Response) {
        encodeBody = init.#encodeBody;
        // Don't pass our strange hybrid Response to undici
        init = init[kInner];
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
      }
      super(new BaseResponse(body, init));
    }

    encodeBody ??= "auto";
    if (encodeBody !== "auto" && encodeBody !== "manual") {
      throw new TypeError(`encodeBody: unexpected value: ${encodeBody}`);
    }
    this.#encodeBody = encodeBody;

    this.#status = status;
    this.#webSocket = webSocket;

    makeEnumerable(Response.prototype, this, enumerableResponseKeys);
    Object.defineProperty(this, kWaitUntil, nonEnumerable);
  }

  clone(): Response {
    if (this.#webSocket) {
      throw new TypeError("Cannot clone a response to a WebSocket handshake.");
    }
    const innerClone = this[kInner].clone();
    const clone = new Response(innerClone.body, innerClone);
    clone[kInputGated] = this[kInputGated];
    clone[kFormDataFiles] = this[kFormDataFiles];
    clone.#encodeBody = this.#encodeBody;
    // Technically don't need to copy status, as it should only be set for
    // WebSocket handshake responses
    clone.#status = this.#status;
    clone[kWaitUntil] = this[kWaitUntil];
    return clone;
  }

  get encodeBody(): "auto" | "manual" {
    return this.#encodeBody;
  }

  get webSocket(): WebSocket | undefined {
    return this.#webSocket;
  }

  waitUntil(): Promise<WaitUntil> {
    return this[kWaitUntil] ?? Promise.resolve([] as unknown as WaitUntil);
  }

  get status(): number {
    return this.#status ?? this[kInner].status;
  }

  // Pass-through standard properties
  get ok(): boolean {
    return this[kInner].ok;
  }
  get statusText(): string {
    return this[kInner].statusText;
  }
  get type(): ResponseType {
    return this[kInner].type;
  }
  get url(): string {
    return this[kInner].url;
  }
  get redirected(): boolean {
    return this[kInner].redirected;
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

export async function fetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  // TODO (someday): support cache using fetch:
  //  https://developers.cloudflare.com/workers/learning/how-the-cache-works#fetch
  //  https://developers.cloudflare.com/workers/examples/cache-using-fetch

  // Don't pass our strange hybrid Request to undici
  if (input instanceof Request) input = input[kInner];
  await waitForOpenOutputGate();
  const baseRes = await baseFetch(input, init);
  const res = new Response(baseRes.body, baseRes);
  await waitForOpenInputGate();
  return withInputGating(res);
}

export function createCompatFetch(
  compat: Compatibility,
  inner: typeof fetch = fetch
): typeof fetch {
  const refusesUnknown = compat.isEnabled("fetch_refuses_unknown_protocols");
  const formDataFiles = compat.isEnabled("formdata_parser_supports_files");
  return async (input, init) => {
    const url = new URL(
      input instanceof Request || input instanceof BaseRequest
        ? input.url
        : input.toString()
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      if (refusesUnknown) {
        throw new TypeError(`Fetch API cannot load: ${url.toString()}`);
      } else {
        if (init) {
          init = new Request(input, init);
        } else if (input instanceof BaseRequest) {
          // BaseRequest's properties aren't enumerable, so convert to a Request
          init = new Request(input);
        } else if (input instanceof Request) {
          init = input;
        }
        // Free to mutate this as we created url at the start of the function
        url.protocol = "http:";
        input = url;
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
    method,
    url,
    status,
    waitUntil,
  }: {
    start: HRTime;
    method: string;
    url: string;
    status?: number;
    waitUntil?: Promise<any[]>;
  }
): Promise<void> {
  const responseTime = millisFromHRTime(process.hrtime(start));

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
    ].join("")
  );
}
