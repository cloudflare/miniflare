import assert from "assert";
import {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocket as WebSocketInterface,
  WebSocketMessageEvent,
} from "@mrbbot/node-fetch";
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
    assert(this.readyState === WebSocket.CONNECTING);
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
    if (this._pair.readyState !== WebSocket.OPEN) return;
    this._pair.dispatchEvent("message", { type: "message", data: message });
  }

  close(code?: number, reason?: string): void {
    assert(this._pair !== undefined);
    if (this._pair.readyState !== WebSocket.OPEN) return;
    this.readyState = WebSocket.CLOSING;
    this._pair.readyState = WebSocket.CLOSING;
    this._pair.dispatchEvent("close", { type: "close", code, reason });
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

export class WebSocketsModule extends Module {
  buildSandbox(): Context {
    return { WebSocketPair };
  }
}
