import {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketMessageEvent,
} from "@mrbbot/node-fetch";
import test from "ava";
import WebSocketClient from "ws";
import { NoOpLog, WebSocket, WebSocketPair } from "../../src";
import {
  WebSocketEvent,
  WebSocketsModule,
  terminateWebSocket,
} from "../../src/modules/ws";
import { useServer } from "../helpers";

const noop = () => {};

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
test("WebSocket: handles events", (t) => {
  const webSocket = new WebSocket();

  const events1: WebSocketEvent[] = [];
  const events2: WebSocketEvent[] = [];
  webSocket.addEventListener("message", (e) => events1.push(e));
  webSocket.addEventListener("message", (e) => events2.push(e));
  webSocket.addEventListener("close", (e) => events1.push(e));
  webSocket.addEventListener("close", (e) => events2.push(e));
  webSocket.addEventListener("error", (e) => events1.push(e));
  webSocket.addEventListener("error", (e) => events2.push(e));

  const messageEvent: WebSocketMessageEvent = {
    type: "message",
    data: "test",
  };
  const closeEvent: WebSocketCloseEvent = {
    type: "close",
    code: 1000,
    reason: "Normal Closure",
  };
  const errorEvent: WebSocketErrorEvent = {
    type: "error",
    error: new Error("Test error"),
  };
  webSocket.dispatchEvent("message", messageEvent);
  webSocket.dispatchEvent("close", closeEvent);
  webSocket.dispatchEvent("error", errorEvent);

  t.deepEqual(events1, [messageEvent, closeEvent, errorEvent]);
  t.deepEqual(events2, [messageEvent, closeEvent, errorEvent]);
});
test("WebSocket: sends message to pair", (t) => {
  const webSocket1 = new WebSocket();
  const webSocket2 = new WebSocket();
  webSocket1._pair = webSocket2;
  webSocket2._pair = webSocket1;
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
  const webSocket1 = new WebSocket();
  const webSocket2 = new WebSocket();
  webSocket1._pair = webSocket2;
  webSocket2._pair = webSocket1;

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
  const webSocket1 = new WebSocket();
  const webSocket2 = new WebSocket();
  webSocket1._pair = webSocket2;
  webSocket2._pair = webSocket1;

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
  const webSocket1 = new WebSocket();
  const webSocket2 = new WebSocket();
  webSocket1._pair = webSocket2;
  webSocket2._pair = webSocket1;
  webSocket1.accept();
  webSocket2.accept();

  const closes: number[] = [];
  webSocket1.addEventListener("close", () => closes.push(1));
  webSocket2.addEventListener("close", () => closes.push(2));

  webSocket1.close();
  // Check both event listeners called once
  t.deepEqual(closes, [1, 2]);
});

test("WebSocketPair: creates linked pair of sockets", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const messages1: string[] = [];
  const messages2: string[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.send("from1");
  webSocket2.send("from2");
  t.deepEqual(messages1, ["from2"]);
  t.deepEqual(messages2, ["from1"]);
});

test("terminateWebSocket: forwards messages from client to worker", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new WebSocketClient(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<WebSocketMessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: closes socket on receiving binary data", async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.send(Buffer.from("test", "utf8"));
  });
  const ws = new WebSocketClient(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<WebSocketCloseEvent>((resolve) => {
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
  const ws = new WebSocketClient(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<WebSocketCloseEvent>((resolve) => {
    worker.addEventListener("close", resolve);
  });

  await terminateWebSocket(ws, client);
  ws.send("test");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});
test("terminateWebSocket: forwards messages from worker to client", async (t) => {
  let eventResolve: (event: { data: any }) => void;
  const eventPromise = new Promise<{ data: any }>(
    (resolve) => (eventResolve = resolve)
  );
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventResolve);
  });
  const ws = new WebSocketClient(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  worker.send("test");
  await terminateWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("terminateWebSocket: closes client socket on worker close", async (t) => {
  let eventResolve: (event: { code: number; reason: string }) => void;
  const eventPromise = new Promise<{ code: number; reason: string }>(
    (resolve) => (eventResolve = resolve)
  );
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("close", eventResolve);
  });
  const ws = new WebSocketClient(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  await terminateWebSocket(ws, client);
  worker.close(1000, "Test Closure");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});

test("buildSandbox: includes WebSocketPair", (t) => {
  const module = new WebSocketsModule(new NoOpLog());
  const sandbox = module.buildSandbox();
  t.true(typeof sandbox.WebSocketPair === "function");
});
