import {
  RequestInfo,
  RequestInit,
  Response,
  createCompatFetch,
} from "@miniflare/core";
import { Plugin, PluginContext, SetupResult } from "@miniflare/shared";
import { upgradingFetch } from "./fetch";
import {
  CloseEvent,
  MessageEvent,
  WebSocket,
  WebSocketPair,
  kClosedOutgoing,
} from "./websocket";

export class WebSocketPlugin extends Plugin {
  #webSockets = new Set<WebSocket>();
  readonly #upgradingFetch: typeof upgradingFetch;

  constructor(ctx: PluginContext) {
    super(ctx);
    this.#upgradingFetch = createCompatFetch(
      ctx,
      upgradingFetch.bind(ctx.fetchMock)
    );
  }

  setup(): SetupResult {
    return {
      globals: {
        MessageEvent,
        CloseEvent,
        WebSocketPair,
        WebSocket,
        // This plugin will always be loaded after CorePlugin, so this overrides
        // the standard non-upgrading fetch
        fetch: this.fetch,
      },
    };
  }

  fetch = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
    const response = await this.#upgradingFetch(input, init);
    if (response.webSocket) this.#webSockets.add(response.webSocket);
    return response;
  };

  reload(): void {
    // Ensure all fetched web sockets are closed
    for (const ws of this.#webSockets) {
      if (!ws[kClosedOutgoing]) ws.close(1012, "Service Restart");
    }
    this.#webSockets.clear();
  }

  dispose(): void {
    return this.reload();
  }
}
