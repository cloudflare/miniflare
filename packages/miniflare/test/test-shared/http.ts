import http from "http";
import { AddressInfo } from "net";
import { URL } from "url";
import { ExecutionContext } from "ava";
import stoppable from "stoppable";
import NodeWebSocket, { WebSocketServer } from "ws";

export async function useServer(
  t: ExecutionContext,
  listener: http.RequestListener,
  webSocketListener?: (socket: NodeWebSocket, req: http.IncomingMessage) => void
): Promise<{ http: URL; ws: URL }> {
  return new Promise((resolve) => {
    const server = stoppable(http.createServer(listener), /* grace */ 0);
    // Only setup web socket server if listener provided
    if (webSocketListener) {
      const wss = new WebSocketServer({ server });
      wss.on("connection", webSocketListener);
    }
    // 0 binds to random unused port
    server.listen(0, () => {
      t.teardown(() => {
        return new Promise((resolve, reject) =>
          server.stop((err) => (err ? reject(err) : resolve()))
        );
      });
      const port = (server.address() as AddressInfo).port;
      resolve({
        http: new URL(`http://localhost:${port}`),
        ws: new URL(`ws://localhost:${port}`),
      });
    });
  });
}
