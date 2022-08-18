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
  kClosed,
} from "./websocket";

const constructError =
  "Failed to construct 'WebSocket': the constructor is not implemented.";

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
        WebSocket: new Proxy(WebSocket, {
          construct() {
            throw new Error(constructError);
          },
          apply() {
            throw new Error(constructError);
          },
        }),
        // This plugin will always be loaded after CorePlugin, so this overrides
        // the standard non-upgrading fetch
        fetch: this.fetch,
      },
    };
  }

  fetch = async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
    // @ts-expect-error `this` is correctly bound in the plugin constructor
    const response = await this.#upgradingFetch(input, init);
    if (response.webSocket) this.#webSockets.add(response.webSocket);
    return response;
  };

  reload(): void {
    // Ensure all fetched web sockets are closed
    for (const ws of this.#webSockets) {
      if (!ws[kClosed]) ws.close(1012, "Service Restart");
    }
    this.#webSockets.clear();
  }

  dispose(): void {
    return this.reload();
  }
}
