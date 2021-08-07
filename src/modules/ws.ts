import assert from "assert";
import StandardWebSocket from "ws";
import { MiniflareError, typedEventTarget } from "../helpers";
import { Context, Module } from "./module";

export class MessageEvent extends Event {
  constructor(public readonly data: string) {
    super("message");
  }
}

export class CloseEvent extends Event {
  constructor(public readonly code?: number, public readonly reason?: string) {
    super("close");
  }
}

export class ErrorEvent extends Event {
  constructor(public readonly error?: Error) {
    super("error");
  }
}

// Maps web sockets to the other side of their connections, we don't want to
// expose this to the user, but this cannot be a private field as we need to
// construct both sockets before setting the circular references
const pairSymbol = Symbol("pair");

type EventMap = {
  message: MessageEvent;
  close: CloseEvent;
  error: ErrorEvent;
};
export class WebSocket extends typedEventTarget<EventMap>() {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;

  #readyState = WebSocket.CONNECTING;
  #sendQueue?: MessageEvent[] = [];
  [pairSymbol]?: WebSocket;

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
        this.dispatchEvent(event);
      }
      this.#sendQueue = undefined;
    }
  }

  send(message: string): void {
    const pair = this[pairSymbol];
    assert(pair !== undefined);
    if (this.#readyState >= WebSocket.CLOSING) {
      throw new Error(
        `WebSocket is not connecting/open: readyState ${this.#readyState} (${
          readyStateNames[this.#readyState]
        })`
      );
    }
    const event = new MessageEvent(message);
    if (pair.#readyState === WebSocket.OPEN) {
      pair.dispatchEvent(event);
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
    const pair = this[pairSymbol];
    assert(pair !== undefined);

    if (
      this.#readyState >= WebSocket.CLOSING ||
      pair.#readyState >= WebSocket.CLOSING
    ) {
      return;
    }

    this.#readyState = WebSocket.CLOSING;
    pair.#readyState = WebSocket.CLOSING;

    // TODO: PR Node.js lib/internal/event_target.js
    this.dispatchEvent(new CloseEvent(code, reason));
    pair.dispatchEvent(new CloseEvent(code, reason));

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
    this[0][pairSymbol] = this[1];
    this[1][pairSymbol] = this[0];
  }
}

export async function terminateWebSocket(
  ws: StandardWebSocket,
  pair: WebSocket
): Promise<void> {
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
    pair.dispatchEvent(new ErrorEvent(error));
  });

  // Forward events from worker to client
  pair.addEventListener("message", (e) => {
    ws.send(e.data);
  });
  pair.addEventListener("close", (e) => {
    ws.close(e.code, e.reason);
  });

  // Our constants are the same as ws's
  if (ws.readyState >= WebSocket.CLOSING) {
    throw new MiniflareError("WebSocket already closed");
  } else if (ws.readyState === WebSocket.CONNECTING) {
    // Wait for client to be open before accepting worker pair
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        ws.off("close", reject);
        ws.off("error", reject);
        resolve(undefined);
      });
      ws.once("close", reject);
      ws.once("error", reject);
    });
  }

  pair.accept();
}

export class WebSocketsModule extends Module {
  buildSandbox(): Context {
    return {
      MessageEvent,
      CloseEvent,
      ErrorEvent,
      WebSocketPair,
    };
  }
}
