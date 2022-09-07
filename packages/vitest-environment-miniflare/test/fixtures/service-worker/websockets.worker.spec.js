import { expect, test } from "vitest";
import { handleWebSocketRequest } from "./service-worker";
setupMiniflareIsolatedStorage();

test("WebSockets", async () => {
  const { webSocket } = handleWebSocketRequest();
  webSocket.accept();
  const res = new Promise((resolve) => {
    webSocket.addEventListener("message", resolve);
  });
  webSocket.send("test");
  expect((await res).data).toBe("echo:test");
});
