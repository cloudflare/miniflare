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

// Maps web sockets to the other side of their connections, we don't want to
// expose this to the user, but this cannot be a private field as we need to
// construct both sockets before setting the circular references
const pairMap = new WeakMap<WebSocket, WebSocket>();

export class WebSocket implements WebSocketInterface {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;

  #listeners: Record<string, WebSocketEventListener[]> = {};
  #readyState = WebSocket.CONNECTING;
  #sendQueue?: WebSocketMessageEvent[] = [];

  get readyState(): number {
    return this.#readyState;
  }

  accept(): void {
    if (this.#readyState !== WebSocket.CONNECTING) {
      throw new Error(
        `WebSocket is not connecting: readyState ${this.#readyState} (${
          readyStateNames[this.#readyState]
        })`
      );
    }
    this.#readyState = WebSocket.OPEN;
    if (this.#sendQueue) {
      for (const event of this.#sendQueue) {
        this.dispatchEvent("message", event);
      }
      this.#sendQueue = undefined;
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
    if (!(type in this.#listeners)) this.#listeners[type] = [];
    this.#listeners[type].push(listener);
  }

  dispatchEvent(type: "message", event: WebSocketMessageEvent): void;
  dispatchEvent(type: "close", event: WebSocketCloseEvent): void;
  dispatchEvent(type: "error", event: WebSocketErrorEvent): void;
  dispatchEvent(type: string, event: WebSocketEvent): void {
    for (const listener of this.#listeners[type] ?? []) {
      listener(event as any);
    }
  }

  send(message: string): void {
    const pair = pairMap.get(this);
    assert(pair !== undefined);
    if (this.#readyState >= WebSocket.CLOSING) {
      throw new Error(
        `WebSocket is not connecting/open: readyState ${this.#readyState} (${
          readyStateNames[this.#readyState]
        })`
      );
    }
    const event: WebSocketMessageEvent = { type: "message", data: message };
    if (pair.#readyState === WebSocket.OPEN) {
      pair.dispatchEvent("message", event);
    } else {
      if (pair.#readyState !== WebSocket.CONNECTING) {
        throw new Error(
          `Pair WebSocket is not connecting: readyState ${pair.#readyState} (${
            readyStateNames[pair.#readyState]
          })`
        );
      }
      assert(pair.#sendQueue !== undefined);
      pair.#sendQueue.push(event);
    }
  }

  close(code?: number, reason?: string): void {
    const pair = pairMap.get(this);
    assert(pair !== undefined);

    if (
      this.#readyState === WebSocket.CLOSED ||
      pair.#readyState === WebSocket.CLOSED
    ) {
      return;
    }

    this.#readyState = WebSocket.CLOSING;
    pair.#readyState = WebSocket.CLOSING;

    const event: WebSocketCloseEvent = { type: "close", code, reason };
    this.dispatchEvent("close", event);
    pair.dispatchEvent("close", event);

    this.#readyState = WebSocket.CLOSED;
    pair.#readyState = WebSocket.CLOSED;
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
    pairMap.set(this[0], this[1]);
    pairMap.set(this[1], this[0]);
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
