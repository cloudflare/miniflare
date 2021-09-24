import { Log, Plugin, SetupResult } from "@miniflare/shared";
import {
  CloseEvent,
  ErrorEvent,
  MessageEvent,
  WebSocket,
  WebSocketPair,
} from "./websocket";

export class WebSocketPlugin extends Plugin {
  constructor(log: Log) {
    super(log);
  }

  setup(): SetupResult {
    return {
      globals: {
        MessageEvent,
        CloseEvent,
        ErrorEvent, // TODO: does this actually exist in the runtime?
        WebSocketPair,
        WebSocket, // TODO: block construction, proxy?
      },
    };
  }
}
