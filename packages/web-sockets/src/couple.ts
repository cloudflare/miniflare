import { viewToBuffer } from "@miniflare/shared";
import StandardWebSocket from "ws";
import {
  ErrorEvent,
  WebSocket,
  kAccepted,
  kClose,
  kClosed,
  kCoupled,
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

  // Forward events from client to worker
  ws.on("message", (message: Buffer, isBinary: boolean) => {
    if (isBinary) {
      pair.send(viewToBuffer(message));
    } else {
      pair.send(message.toString());
    }
  });
  ws.on("close", (code: number, reason: Buffer) => {
    if (!pair[kClosed]) pair[kClose](code, reason.toString());
  });
  ws.on("error", (error) => {
    pair.dispatchEvent(new ErrorEvent("error", { error }));
  });

  // Forward events from worker to client
  pair.addEventListener("message", (e) => {
    ws.send(e.data);
  });
  pair.addEventListener("close", (e) => {
    if (ws.readyState < StandardWebSocket.CLOSING) ws.close(e.code, e.reason);
  });

  if (ws.readyState === StandardWebSocket.CONNECTING) {
    // Wait for client to be open before accepting worker pair (which would
    // release buffered messages)
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        pair.accept();
        pair[kCoupled] = true;

        ws.off("close", reject);
        ws.off("error", reject);
        resolve();
      });
      ws.once("close", reject);
      ws.once("error", reject);
    });
  } else {
    // Accept worker pair immediately
    pair.accept();
    pair[kCoupled] = true;
    // Throw error if socket is already closing/closed
    if (ws.readyState >= StandardWebSocket.CLOSING) {
      throw new TypeError("Incoming WebSocket connection already closed.");
    }
  }
}
