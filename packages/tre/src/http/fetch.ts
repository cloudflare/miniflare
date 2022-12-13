import http from "http";
import { Headers, RequestInfo, fetch as baseFetch } from "undici";
import NodeWebSocket from "ws";
import { DeferredPromise } from "../shared";
import { Request, RequestInit } from "./request";
import { Response } from "./response";
import { WebSocketPair, coupleWebSocket } from "./websocket";

const ignored = ["transfer-encoding", "connection", "keep-alive", "expect"];
function headersFromIncomingRequest(req: http.IncomingMessage): Headers {
  const entries = Object.entries(req.headers).filter(
    (pair): pair is [string, string | string[]] => {
      const [name, value] = pair;
      return !ignored.includes(name) && value !== undefined;
    }
  );
  return new Headers(Object.fromEntries(entries));
}

export async function fetch(
  input: RequestInfo,
  init?: RequestInit | Request
): Promise<Response> {
  const request = new Request(input, init as RequestInit);

  // Handle WebSocket upgrades
  if (
    request.method === "GET" &&
    request.headers.get("upgrade") === "websocket"
  ) {
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
    const ws = new NodeWebSocket(url, protocols, {
      followRedirects: request.redirect === "follow",
      headers,
    });

    // Get response headers from upgrade
    const headersPromise = new DeferredPromise<Headers>();
    ws.once("upgrade", (req) => {
      headersPromise.resolve(headersFromIncomingRequest(req));
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

  const response = await baseFetch(request);
  return new Response(response.body, response);
}
