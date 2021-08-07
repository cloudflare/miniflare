import assert from "assert";
import test from "ava";
import StandardWebSocket from "ws";
import {
  CloseEvent,
  MessageEvent,
  Miniflare,
  MiniflareError,
  NoOpLog,
  Request,
  WebSocket,
  WebSocketPair,
} from "../../src";
import { WebSocketsModule, terminateWebSocket } from "../../src/modules/ws";
import { noop, triggerPromise, useServer } from "../helpers";

test("WebSocket: accepts only in connecting state", (t) => {
  const webSocket = new WebSocket();
  t.is(webSocket.readyState, WebSocket.CONNECTING);
  webSocket.accept();
  t.is(webSocket.readyState, WebSocket.OPEN);
  t.throws(() => webSocket.accept(), {
    instanceOf: Error,
    message: "WebSocket is not connecting: readyState 1 (OPEN)",
  });
});
test("WebSocket: sends message to pair", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const messages1: string[] = [];
  const messages2: string[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.send("from1");
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, ["from1"]);
  webSocket2.send("from2");
  t.deepEqual(messages1, ["from2"]);
  t.deepEqual(messages2, ["from1"]);
});
test("WebSocket: queues messages if pair connecting", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  const messages1: string[] = [];
  const messages2: string[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.send("from1_1");
  webSocket2.send("from2_1");
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, []);

  webSocket1.accept();
  t.deepEqual(messages1, ["from2_1"]);
  t.deepEqual(messages2, []);

  webSocket1.send("from1_2");
  webSocket2.send("from2_2");
  t.deepEqual(messages1, ["from2_1", "from2_2"]);
  t.deepEqual(messages2, []);

  webSocket2.accept();
  t.deepEqual(messages1, ["from2_1", "from2_2"]);
  t.deepEqual(messages2, ["from1_1", "from1_2"]);
});
test("WebSocket: fails to send message to pair if either side closed", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  webSocket1.accept();
  webSocket2.accept();
  webSocket1.close();
  t.throws(() => webSocket1.send("from1"), {
    instanceOf: Error,
    message: "WebSocket is not connecting/open: readyState 3 (CLOSED)",
  });
  t.throws(() => webSocket2.send("from2"), {
    instanceOf: Error,
    message: "WebSocket is not connecting/open: readyState 3 (CLOSED)",
  });
});
test("WebSocket: closes both sides of pair", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const closes: number[] = [];
  webSocket1.addEventListener("close", () => closes.push(1));
  webSocket2.addEventListener("close", () => closes.push(2));

  webSocket1.close();
  // Check both event listeners called once
  t.deepEqual(closes, [1, 2]);
});

test("terminateWebSocket: forwards messages from client to worker before termination", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  // Accept before termination, simulates accepting in worker code before returning response
  worker.accept();
  const eventPromise = new Promise<MessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: forwards messages from client to worker after termination", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  await terminateWebSocket(ws, client);
  // Accept after termination, simulates accepting in worker code after returning response
  const eventPromise = new Promise<MessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  // accept() after addEventListener() as it dispatches queued messages
  worker.accept();

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: closes socket on receiving binary data", async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.send(Buffer.from("test", "utf8"));
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<CloseEvent>((resolve) => {
    worker.addEventListener("close", resolve);
  });
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.code, 1003);
  t.is(event.reason, "Unsupported Data");
});
test("terminateWebSocket: closes worker socket on client close", async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", () => ws.close(1000, "Test Closure"));
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<CloseEvent>((resolve) => {
    worker.addEventListener("close", resolve);
  });

  await terminateWebSocket(ws, client);
  ws.send("test");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});
test("terminateWebSocket: forwards messages from worker to client before termination", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Send before termination, simulates sending message in worker code before returning response
  worker.send("test");
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: forwards messages from worker to client after termination", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  await terminateWebSocket(ws, client);
  // Send after termination, simulates sending message in worker code after returning response
  worker.send("test");

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: closes client socket on worker close", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{
    code: number;
    reason: string;
  }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  await terminateWebSocket(ws, client);
  worker.close(1000, "Test Closure");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});
test("terminateWebSocket: accepts worker socket immediately if already open", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Send before termination, simulates sending message in worker code before returning response
  worker.send("test");
  // Make sure socket is open before terminating
  const [openTrigger, openPromise] = triggerPromise<void>();
  ws.addEventListener("open", openTrigger);
  await openPromise;
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: throws if web socket already closed", async (t) => {
  const server = await useServer(t, noop, noop);
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Make sure socket is open before closing
  const [openTrigger, openPromise] = triggerPromise<void>();
  ws.addEventListener("open", openTrigger);
  await openPromise;
  // Make sure socket is closed before terminating
  ws.close(1000, "Test Closure");
  await t.throwsAsync(terminateWebSocket(ws, client), {
    instanceOf: MiniflareError,
    message: "WebSocket already closed",
  });
});

test("buildSandbox: includes WebSocketPair", (t) => {
  const module = new WebSocketsModule(new NoOpLog());
  const sandbox = module.buildSandbox();
  t.true(typeof sandbox.WebSocketPair === "function");
});
test("buildSandbox: sends and responds to web socket messages", async (t) => {
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
  const mf = new Miniflare({ script });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.not(res.webSocket, undefined);
  assert(res.webSocket); // for TypeScript

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: string[] = [];
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
