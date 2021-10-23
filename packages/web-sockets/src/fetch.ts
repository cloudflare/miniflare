import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  gatedFetch,
} from "@miniflare/core";
import StandardWebSocket from "ws";
import { coupleWebSocket } from "./couple";
import { WebSocketPair } from "./websocket";

export async function upgradingFetch(
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
    return new Response(null, {
      status: 101,
      webSocket: worker,
    });
  }

  return gatedFetch(request);
}
