import { once } from "events";
import { viewToBuffer } from "@miniflare/shared";
import StandardWebSocket from "ws";
import {
  ErrorEvent,
  WebSocket,
  kAccepted,
  kClose,
  kClosedOutgoing,
  kCoupled,
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

  // Forward messages from client to worker (register this before `open` to
  // ensure messages queued before other pair `accept`s to release)
  ws.on("message", (message: Buffer, isBinary: boolean) => {
    // Silently discard messages received after close:
    // https://www.rfc-editor.org/rfc/rfc6455#section-1.4
    if (!pair[kClosedOutgoing]) {
      // Convert binary messages to `ArrayBuffer`s (note `[kSend]` will queue
      // messages if other pair hasn't `accept`ed yet)
      pair[kSend](isBinary ? viewToBuffer(message) : message.toString());
    }
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
    // dispatched.
    await once(ws, "open");
  } else if (ws.readyState >= StandardWebSocket.CLOSING) {
    throw new TypeError("Incoming WebSocket connection already closed.");
  }
  pair.accept();
  pair[kCoupled] = true;

  // Forward close/error events from client to worker (register this after
  // `once(ws, "open")` to ensure close/error due to connection failure throws
  // and can be caught from this function: https://github.com/cloudflare/miniflare/issues/229)
  ws.on("close", (code: number, reason: Buffer) => {
    // `[kClose]` skips code/reason validation, allowing reserved codes
    // (e.g. 1005 for "No Status Received")
    if (!pair[kClosedOutgoing]) pair[kClose](code, reason.toString());
  });
  ws.on("error", (error) => {
    pair.dispatchEvent(new ErrorEvent("error", { error }));
  });
}
