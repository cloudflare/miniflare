import http from "http";
import { Log, nonCircularClone } from "@miniflare/shared";
import {
  WebSocket,
  WebSocketPair,
  coupleWebSocket,
} from "@miniflare/web-sockets";
import { Colorize, blue, bold, green, grey, red, yellow } from "kleur/colors";
import {
  Request as BaseRequest,
  RequestInfo as BaseRequestInfo,
  RequestInit as BaseRequestInit,
  Response as BaseResponse,
  ResponseInit as BaseResponseInit,
  BodyInit,
  fetch as baseFetch,
} from "undici";
import StandardWebSocket from "ws";

export type RequestInfo = BaseRequestInfo | Request;

export interface RequestInit extends BaseRequestInit {
  readonly cf?: any; // TODO: type properly
}

const kCf = Symbol("kCf");

export class Request extends BaseRequest {
  private [kCf]?: any;

  constructor(input: RequestInfo, init?: RequestInit) {
    super(input, init);
    const cf = input instanceof Request ? input[kCf] : init?.cf;
    this[kCf] = cf ? nonCircularClone(cf) : undefined;
  }

  get cf(): any | undefined {
    return this[kCf];
  }

  clone = (): Request => {
    // @ts-expect-error cloned is a BaseRequest, but we're changing its
    // prototype. This is horrible, but it works. ;)
    const cloned: Request = super.clone();
    Object.setPrototypeOf(cloned, Request.prototype);
    cloned[kCf] = this.cf ? nonCircularClone(this.cf) : undefined;
    cloned.clone = this.clone.bind(cloned);
    return cloned;
  };
}

export interface ResponseInit extends BaseResponseInit {
  readonly webSocket?: WebSocket;
}

const kStatus = Symbol("kStatus");
const kWebSocket = Symbol("kWebSocket");
const kWaitUntil = Symbol("kWaitUntil");

export class Response<
  WaitUntil extends any[] = unknown[]
> extends BaseResponse {
  private [kStatus]?: number;
  private [kWebSocket]?: WebSocket;
  [kWaitUntil]?: Promise<WaitUntil>;

  constructor(body?: BodyInit, init?: ResponseInit) {
    // Status 101 Switching Protocols would normally throw a RangeError, but we
    // need to allow it for WebSockets
    let originalStatus: number | undefined;
    if (init?.webSocket) {
      if (init.status !== 101) {
        throw new RangeError(
          "Responses with a WebSocket must have status code 101."
        );
      }
      originalStatus = init.status;
      init = { ...init, status: 200 };
    }
    super(body, init);
    this[kStatus] = originalStatus;
    this[kWebSocket] = init?.webSocket;
  }

  // @ts-expect-error status is defined as an accessor in undici
  get status(): number {
    return this[kStatus] ?? super.status;
  }

  get webSocket(): WebSocket | undefined {
    return this[kWebSocket];
  }

  waitUntil(): Promise<WaitUntil> {
    return this[kWaitUntil] ?? Promise.resolve([] as unknown as WaitUntil);
  }

  clone = (): Response => {
    if (this[kWebSocket]) {
      throw new TypeError("Cannot clone a response to a WebSocket handshake.");
    }

    // @ts-expect-error cloned is a BaseResponse, but we're changing its
    // prototype. This is horrible, but it works. ;)
    const cloned: Response = super.clone();
    Object.setPrototypeOf(cloned, Response.prototype);
    cloned[kStatus] = this[kStatus];
    cloned[kWaitUntil] = this[kWaitUntil];
    cloned.clone = this.clone.bind(cloned);
    return cloned;
  };
}

function convertBaseResponse<WaitUntil extends any[]>(
  res: BaseResponse
): Response<WaitUntil> {
  return new Response(res.body, res);
}

export function withWaitUntil<WaitUntil extends any[]>(
  res: Response | BaseResponse,
  waitUntil: Promise<WaitUntil>
): Response<WaitUntil> {
  const resWaitUntil: Response<WaitUntil> =
    res instanceof Response
      ? (res as Response<WaitUntil>)
      : convertBaseResponse(res);
  resWaitUntil[kWaitUntil] = waitUntil;
  return resWaitUntil;
}

export async function fetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(input, init);

  // Cloudflare ignores request Host
  request.headers.delete("host");

  // Handle web socket upgrades
  if (
    request.method === "GET" &&
    request.headers.get("upgrade") === "websocket"
  ) {
    // Establish web socket connection
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      headers[key] = value;
    }
    const ws = new StandardWebSocket(request.url, {
      followRedirects: request.redirect === "follow",
      headers,
    });

    // Couple web socket with pair and resolve
    const [worker, client] = Object.values(new WebSocketPair());
    await coupleWebSocket(ws, client);
    return new Response(null, { webSocket: worker });
  }

  // TODO: (low priority) support cache using fetch:
  //  https://developers.cloudflare.com/workers/learning/how-the-cache-works#fetch
  //  https://developers.cloudflare.com/workers/examples/cache-using-fetch

  return convertBaseResponse(await baseFetch(request));
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
