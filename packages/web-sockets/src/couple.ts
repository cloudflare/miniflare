import { viewToBuffer } from "@miniflare/shared";
import StandardWebSocket from "ws";
import { ErrorEvent, WebSocket, kAccepted, kCoupled } from "./websocket";

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
  pair[kCoupled] = true;

  // Forward events from client to worker
  ws.on("message", (message: Buffer, isBinary: boolean) => {
    if (isBinary) {
      pair.send(viewToBuffer(message));
    } else {
      pair.send(message.toString());
    }
  });
  ws.on("close", (code: number, reason: Buffer) => {
    pair.close(code, reason.toString());
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

  if (ws.readyState >= StandardWebSocket.CLOSING) {
    throw new TypeError("Incoming WebSocket connection already closed.");
  } else if (ws.readyState === StandardWebSocket.CONNECTING) {
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
