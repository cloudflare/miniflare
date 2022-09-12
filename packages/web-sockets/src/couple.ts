import { once } from "events";
import { viewToBuffer } from "@miniflare/shared";
import StandardWebSocket from "ws";
import {
  WebSocket,
  kAccepted,
  kClose,
  kClosedOutgoing,
  kCoupled,
  kError,
  kSend,
} from "./websocket";

export async function coupleWebSocket(
  ws: StandardWebSocket,
  pair: WebSocket
): Promise<void> {
  if (pair[kCoupled]) {
    throw new TypeError(
      "Can't return WebSocket that was already used in a response."
    );
  }
  if (pair[kAccepted]) {
    throw new TypeError(
      "Can't return WebSocket in a Response after calling accept()."
    );
  }

  // Forward events from client to worker (register this before `open` to ensure
  // events queued before other pair `accept`s to release)
  ws.on("message", (message: Buffer, isBinary: boolean) => {
    // Silently discard messages received after close:
    // https://www.rfc-editor.org/rfc/rfc6455#section-1.4
    if (!pair[kClosedOutgoing]) {
      // Note `[kSend]` skips accept check and will queue messages if other pair
      // hasn't `accept`ed yet. Also convert binary messages to `ArrayBuffer`s.
      pair[kSend](isBinary ? viewToBuffer(message) : message.toString());
    }
  });
  ws.on("close", (code: number, reason: Buffer) => {
    // Silently discard closes received after close
    if (!pair[kClosedOutgoing]) {
      // Note `[kClose]` skips accept check and will queue messages if other
      // pair hasn't `accept`ed yet. It also skips code/reason validation,
      // allowing reserved codes (e.g. 1005 for "No Status Received").
      pair[kClose](code, reason.toString());
    }
  });
  ws.on("error", (error) => {
    pair[kError](error);
  });

  // Forward events from worker to client
  pair.addEventListener("message", (e) => {
    ws.send(e.data);
  });
  pair.addEventListener("close", (e) => {
    if (e.code === 1005 /* No Status Received */) {
      ws.close();
    } else {
      ws.close(e.code, e.reason);
    }
  });

  if (ws.readyState === StandardWebSocket.CONNECTING) {
    // Wait for client to be open before accepting worker pair (which would
    // release buffered messages). Note this will throw if an "error" event is
    // dispatched (https://github.com/cloudflare/miniflare/issues/229).
    await once(ws, "open");
  } else if (ws.readyState >= StandardWebSocket.CLOSING) {
    throw new TypeError("Incoming WebSocket connection already closed.");
  }
  pair.accept();
  pair[kCoupled] = true;
}
