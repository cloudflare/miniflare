import assert from "assert";
import {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocket as WebSocketInterface,
  WebSocketMessageEvent,
} from "@mrbbot/node-fetch";
import ws from "ws";
import { Context, EventListener, Module } from "./module";

type WebSocketEvent =
  | WebSocketMessageEvent
  | WebSocketCloseEvent
  | WebSocketErrorEvent;

type WebSocketEventListener =
  | EventListener<WebSocketMessageEvent>
  | EventListener<WebSocketCloseEvent>
  | EventListener<WebSocketErrorEvent>;

export class WebSocket implements WebSocketInterface {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;

  private _listeners: Record<string, WebSocketEventListener[]> = {};
  private readyState = WebSocket.CONNECTING;
  _pair?: WebSocket;

  accept(): void {
    assert.strictEqual(this.readyState, WebSocket.CONNECTING);
    this.readyState = WebSocket.OPEN;
  }

  addEventListener(
    type: "message",
    listener: EventListener<WebSocketMessageEvent>
  ): void;
  addEventListener(
    type: "close",
    listener: EventListener<WebSocketCloseEvent>
  ): void;
  addEventListener(
    type: "error",
    listener: EventListener<WebSocketErrorEvent>
  ): void;
  addEventListener(type: string, listener: WebSocketEventListener): void {
    if (!(type in this._listeners)) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  dispatchEvent(type: "message", event: WebSocketMessageEvent): void;
  dispatchEvent(type: "close", event: WebSocketCloseEvent): void;
  dispatchEvent(type: "error", event: WebSocketErrorEvent): void;
  dispatchEvent(type: string, event: WebSocketEvent): void {
    for (const listener of this._listeners[type] ?? []) {
      listener(event as any);
    }
  }

  send(message: string): void {
    assert(this._pair !== undefined);
    assert.strictEqual(this.readyState, WebSocket.OPEN);
    assert.strictEqual(this._pair.readyState, WebSocket.OPEN);
    this._pair.dispatchEvent("message", { type: "message", data: message });
  }

  close(code?: number, reason?: string): void {
    assert(this._pair !== undefined);

    if (
      this.readyState === WebSocket.CLOSED ||
      this._pair.readyState === WebSocket.CLOSED
    ) {
      return;
    }

    this.readyState = WebSocket.CLOSING;
    this._pair.readyState = WebSocket.CLOSING;

    const event: WebSocketCloseEvent = { type: "close", code, reason };
    this.dispatchEvent("close", event);
    this._pair.dispatchEvent("close", event);

    this.readyState = WebSocket.CLOSED;
    this._pair.readyState = WebSocket.CLOSED;
  }
}

export class WebSocketPair {
  [key: string]: WebSocket;
  0: WebSocket;
  1: WebSocket;

  constructor() {
    this[0] = new WebSocket();
    this[1] = new WebSocket();
    this[0]._pair = this[1];
    this[1]._pair = this[0];
  }
}

export function terminateWebSocket(ws: ws, pair: WebSocketInterface): void {
  pair.accept();

  // TODO: think about whether we want to log messages here
  // Forward events from client to worker
  ws.on("message", (message) => {
    if (typeof message === "string") {
      pair.send(message);
    } else {
      ws.close(1003, "Unsupported Data");
    }
  });
  ws.on("close", (code, reason) => {
    pair.close(code, reason);
  });
  ws.on("error", (error) => {
    pair.dispatchEvent("error", { type: "error", error });
  });

  // Forward events from worker to client
  pair.addEventListener("message", ({ data }) => {
    ws.send(data);
  });
  pair.addEventListener("close", ({ code, reason }) => {
    ws.close(code, reason);
  });
}

export class WebSocketsModule extends Module {
  buildSandbox(): Context {
    return { WebSocketPair };
  }
}
