import { URL } from "url";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  fetch,
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
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError(
        `Fetch API cannot load: ${url.toString()}.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.`
      );
    }
    url.protocol = url.protocol.replace("http", "ws");
    const ws = new StandardWebSocket(url, {
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

  return fetch(request);
}
