import { URL } from "url";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  _headersFromIncomingRequest,
  fetch,
} from "@miniflare/core";
import { getRequestContext } from "@miniflare/shared";
import { Dispatcher, Headers } from "undici";
import StandardWebSocket from "ws";
import { WebSocketPair, coupleWebSocket } from "./websocket";

export async function upgradingFetch(
  this: Dispatcher | unknown,
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  const request = new Request(input, init);

  // Handle web socket upgrades
  if (
    request.method === "GET" &&
    request.headers.get("upgrade") === "websocket"
  ) {
    // All fetches count as subrequests
    getRequestContext()?.incrementExternalSubrequests();

    // Check request protocol. Note, upgradingFetch will be wrapped with
    // createCompatFetch, which will rewrite the protocol to "http:" (e.g. when
    // it's set to "ws:") if the fetch_refuses_unknown_protocols compatibility
    // flag isn't enabled, so we don't need to handle that here.
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError(
        `Fetch API cannot load: ${url.toString()}.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.`
      );
    }
    url.protocol = url.protocol.replace("http", "ws");

    // Normalise request headers to a format ws understands, extracting the
    // Sec-WebSocket-Protocol header as ws treats this differently
    const headers: Record<string, string> = {};
    let protocols: string[] | undefined;
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase() === "sec-websocket-protocol") {
        protocols = value.split(",").map((protocol) => protocol.trim());
      } else {
        headers[key] = value;
      }
    }

    // Establish web socket connection
    const ws = new StandardWebSocket(url, protocols, {
      followRedirects: request.redirect === "follow",
      headers,
    });

    // Get response headers from upgrade
    let headersResolve: (headers: Headers) => void;
    const headersPromise = new Promise<Headers>((resolve) => {
      headersResolve = resolve;
    });
    ws.once("upgrade", (req) => {
      headersResolve(_headersFromIncomingRequest(req));
    });

    // Couple web socket with pair and resolve
    const [worker, client] = Object.values(new WebSocketPair());
    await coupleWebSocket(ws, client);
    return new Response(null, {
      status: 101,
      webSocket: worker,
      headers: await headersPromise,
    });
  }

  return fetch.call(this, request);
}
