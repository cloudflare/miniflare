import assert from "assert";
import { CorePlugin, Request } from "@miniflare/core";
import {
  CloseEvent,
  ErrorEvent,
  MessageEvent,
  WebSocket,
  WebSocketPair,
  WebSocketPlugin,
} from "@miniflare/web-sockets";
import test from "ava";
import { NoOpLog, triggerPromise, useMiniflare } from "test:@miniflare/shared";

test("WebSocketPlugin: setup: includes WebSocket stuff in globals", (t) => {
  const plugin = new WebSocketPlugin(new NoOpLog());
  const result = plugin.setup();
  t.deepEqual(result.globals, {
    MessageEvent,
    CloseEvent,
    ErrorEvent,
    WebSocketPair,
    WebSocket,
  });
});

test("MiniflareCore: sends and responds to web socket messages", async (t) => {
  const script = `(${(() => {
    const sandbox = self as any;
    sandbox.addEventListener("fetch", (e: FetchEvent) => {
      const [client, worker] = Object.values(new sandbox.WebSocketPair());
      worker.accept();
      // Echo received messages
      worker.addEventListener("message", (e: MessageEvent) => {
        worker.send(e.data);
      });
      // Send message to test queuing
      worker.send("hello client");
      e.respondWith(
        new sandbox.Response(null, {
          status: 101,
          webSocket: client,
        })
      );
    });
  }).toString()})()`;
  const mf = useMiniflare({ CorePlugin, WebSocketPlugin }, { script });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.not(res.webSocket, undefined);
  assert(res.webSocket); // for TypeScript

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: (string | ArrayBuffer)[] = [];
  res.webSocket.addEventListener("message", (e) => {
    messages.push(e.data);
    if (e.data === "hello worker") eventTrigger();
  });
  // accept() after addEventListener() as it dispatches queued messages
  res.webSocket.accept();
  res.webSocket.send("hello worker");

  await eventPromise;
  t.deepEqual(messages, ["hello client", "hello worker"]);
});
