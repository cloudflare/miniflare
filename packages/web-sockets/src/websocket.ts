import assert from "assert";
import {
  InputGatedEventTarget,
  waitForOpenOutputGate,
} from "@miniflare/shared";

export class MessageEvent extends Event {
  constructor(readonly data: ArrayBuffer | string) {
    super("message");
  }
}

export class CloseEvent extends Event {
  constructor(
    readonly code = 1005,
    readonly reason?: string,
    readonly wasClean = false
  ) {
    super("close");
  }
}

export class ErrorEvent extends Event {
  constructor(readonly error?: Error) {
    super("error");
  }
}

// Maps web sockets to the other side of their connections, we don't want to
// expose this to the user, but this cannot be a private field as we need to
// construct both sockets before setting the circular references
const kPair = Symbol("kPair");

export const kAccepted = Symbol("kAccepted");
export const kCoupled = Symbol("kCoupled");
export const kClosed = Symbol("kClosed");

export type WebSocketEventMap = {
  message: MessageEvent;
  close: CloseEvent;
  error: ErrorEvent;
};
export class WebSocket extends InputGatedEventTarget<WebSocketEventMap> {
  #sendQueue?: MessageEvent[] = [];
  [kPair]: WebSocket;
  [kAccepted] = false;
  [kCoupled] = false;
  [kClosed] = false;

  accept(): void {
    if (this[kCoupled]) {
      throw new TypeError(
        "Can't accept() WebSocket that was already used in a response."
      );
    }

    if (this[kAccepted]) return;
    this[kAccepted] = true;

    const sendQueue = this.#sendQueue;
    if (sendQueue) {
      for (const event of sendQueue) this.dispatchEvent(event);
      this.#sendQueue = undefined;
    }
  }

  send(message: ArrayBuffer | string): void {
    if (!this[kAccepted]) {
      throw new TypeError(
        "You must call accept() on this WebSocket before sending messages."
      );
    }
    if (this[kClosed]) {
      throw new TypeError("Can't call WebSocket send() after close().");
    }

    const event = new MessageEvent(message);
    void this.#dispatchMessageEvent(event);
  }

  async #dispatchMessageEvent(event: MessageEvent): Promise<void> {
    await waitForOpenOutputGate();
    const pair = this[kPair];
    if (pair[kAccepted]) {
      pair.dispatchEvent(event);
    } else {
      const sendQueue = pair.#sendQueue;
      assert(sendQueue !== undefined);
      sendQueue.push(event);
    }
  }

  close(code?: number, reason?: string): void {
    const pair = this[kPair];
    if (!this[kAccepted]) {
      throw new TypeError(
        "You must call accept() on this WebSocket before sending messages."
      );
    }
    if (this[kClosed]) throw new TypeError("WebSocket already closed");
    if (code) {
      // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
      const validCode =
        code >= 1000 &&
        code < 5000 &&
        code !== 1004 &&
        code !== 1005 &&
        code !== 1006 &&
        code !== 1015;
      if (!validCode) throw new TypeError("Invalid WebSocket close code.");
    }
    if (reason !== undefined && code === undefined) {
      throw new TypeError(
        "If you specify a WebSocket close reason, you must also specify a code."
      );
    }

    this[kClosed] = true;
    pair[kClosed] = true;
    void this.#dispatchCloseEvent(code, reason);
  }

  async #dispatchCloseEvent(code?: number, reason?: string): Promise<void> {
    await waitForOpenOutputGate();
    // See https://github.com/nodejs/node/pull/39772
    this.dispatchEvent(new CloseEvent(code, reason));
    this[kPair].dispatchEvent(new CloseEvent(code, reason));
  }
}

export type WebSocketPair = {
  0: WebSocket;
  1: WebSocket;
};

export const WebSocketPair: { new (): WebSocketPair } = function (
  this: WebSocketPair
) {
  if (!(this instanceof WebSocketPair)) {
    throw new TypeError(
      "Failed to construct 'WebSocketPair': Please use the 'new' operator, this object constructor cannot be called as a function."
    );
  }
  this[0] = new WebSocket();
  this[1] = new WebSocket();
  this[0][kPair] = this[1];
  this[1][kPair] = this[0];
} as any;
