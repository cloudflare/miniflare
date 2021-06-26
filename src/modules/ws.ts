import assert from "assert";
import {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocket as WebSocketInterface,
  WebSocketMessageEvent,
} from "@mrbbot/node-fetch";
import ws from "ws";
import { Context, EventListener, Module } from "./module";

export type WebSocketEvent =
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
  private _readyState = WebSocket.CONNECTING;
  private _sendQueue?: WebSocketMessageEvent[] = [];
  _pair?: WebSocket;

  get readyState(): number {
    return this._readyState;
  }

  accept(): void {
    if (this._readyState !== WebSocket.CONNECTING) {
      throw new Error(
        `WebSocket is not connecting: readyState ${this._readyState} (${
          readyStateNames[this._readyState]
        })`
      );
    }
    this._readyState = WebSocket.OPEN;
    if (this._sendQueue) {
      for (const event of this._sendQueue) {
        this.dispatchEvent("message", event);
      }
      delete this._sendQueue;
    }
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
    if (this._readyState >= WebSocket.CLOSING) {
      throw new Error(
        `WebSocket is not connecting/open: readyState ${this._readyState} (${
          readyStateNames[this._readyState]
        })`
      );
    }
    const event: WebSocketMessageEvent = { type: "message", data: message };
    if (this._pair._readyState === WebSocket.OPEN) {
      this._pair.dispatchEvent("message", event);
    } else {
      if (this._pair._readyState !== WebSocket.CONNECTING) {
        throw new Error(
          `Pair WebSocket is not connecting: readyState ${
            this._pair._readyState
          } (${readyStateNames[this._pair._readyState]})`
        );
      }
      assert(this._pair._sendQueue !== undefined);
      this._pair._sendQueue.push(event);
    }
  }

  close(code?: number, reason?: string): void {
    assert(this._pair !== undefined);

    if (
      this._readyState === WebSocket.CLOSED ||
      this._pair._readyState === WebSocket.CLOSED
    ) {
      return;
    }

    this._readyState = WebSocket.CLOSING;
    this._pair._readyState = WebSocket.CLOSING;

    const event: WebSocketCloseEvent = { type: "close", code, reason };
    this.dispatchEvent("close", event);
    this._pair.dispatchEvent("close", event);

    this._readyState = WebSocket.CLOSED;
    this._pair._readyState = WebSocket.CLOSED;
  }
}

const readyStateNames = {
  [WebSocket.CONNECTING]: "CONNECTING",
  [WebSocket.OPEN]: "OPEN",
  [WebSocket.CLOSING]: "CLOSING",
  [WebSocket.CLOSED]: "CLOSED",
};

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

export async function terminateWebSocket(
  ws: ws,
  pair: WebSocketInterface
): Promise<void> {
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

  // Wait for client to be open before accepting worker pair
  await new Promise((resolve, reject) => {
    ws.once("open", () => {
      ws.off("close", reject);
      ws.off("error", reject);
      resolve(undefined);
    });
    ws.once("close", reject);
    ws.once("error", reject);
  });

  pair.accept();
}

export class WebSocketsModule extends Module {
  buildSandbox(): Context {
    return { WebSocketPair };
  }
}
