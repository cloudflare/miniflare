import assert from "assert";
import http from "http";
import { AddressInfo } from "net";
import { viewToBuffer } from "@miniflare/shared";
import {
  noop,
  triggerPromise,
  useServer,
  utf8Decode,
  utf8Encode,
} from "@miniflare/shared-test";
import {
  WebSocketPair,
  _kClose,
  coupleWebSocket,
} from "@miniflare/web-sockets";
import { CloseEvent, MessageEvent } from "@miniflare/web-sockets";
import test from "ava";
import StandardWebSocket, {
  Event as WebSocketEvent,
  WebSocketServer,
} from "ws";

test("coupleWebSocket: throws if already coupled", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [client] = Object.values(new WebSocketPair());
  await coupleWebSocket(ws, client);
  await t.throwsAsync(coupleWebSocket({} as any, client), {
    instanceOf: TypeError,
    message: "Can't return WebSocket that was already used in a response.",
  });
});
test("coupleWebSocket: throws if already accepted", async (t) => {
  const [client] = Object.values(new WebSocketPair());
  client.accept();
  await t.throwsAsync(coupleWebSocket({} as any, client), {
    instanceOf: TypeError,
    message: "Can't return WebSocket in a Response after calling accept().",
  });
});
test("coupleWebSocket: forwards messages from client to worker before coupling", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  // Accept before coupling, simulates accepting in worker code before returning response
  worker.accept();
  const eventPromise = new Promise<MessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("coupleWebSocket: forwards messages from client to worker after coupling", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  await coupleWebSocket(ws, client);
  // Accept after coupling, simulates accepting in worker code after returning response
  const eventPromise = new Promise<MessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  // accept() after addEventListener() as it dispatches queued messages
  worker.accept();

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("coupleWebSocket: forwards binary messages from client to worker", async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.send(Buffer.from("test", "utf8"));
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  const eventPromise = new Promise<MessageEvent>((resolve) => {
    worker.addEventListener("message", resolve);
  });
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.true(event.data instanceof ArrayBuffer);
  assert(event.data instanceof ArrayBuffer);
  t.is(utf8Decode(new Uint8Array(event.data)), "test");
});
test("coupleWebSocket: closes worker socket on client close", async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", () => ws.close(1000, "Test Closure"));
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());
  worker.accept();
  const eventPromise = new Promise<CloseEvent>((resolve) => {
    worker.addEventListener("close", resolve);
  });

  await coupleWebSocket(ws, client);
  ws.send("test");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});
test("coupleWebSocket: closes worker socket with invalid client close code", async (t) => {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    // Close WebSocket without code, defaults to 1005 (No Status Received)
    // which would be an invalid code if passed normally
    ws.close();
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  const ws = new StandardWebSocket(`ws://localhost:${port}`);
  const [client, worker] = Object.values(new WebSocketPair());

  const [eventTrigger, eventPromise] = triggerPromise<CloseEvent>();
  worker.addEventListener("close", eventTrigger);
  worker.accept();
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.code, 1005);
});

test("coupleWebSocket: forwards messages from worker to client before coupling", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Send before coupling, simulates sending message in worker code before returning response
  worker.send("test");
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("coupleWebSocket: forwards messages from worker to client after coupling", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  await coupleWebSocket(ws, client);
  // Send after coupling, simulates sending message in worker code after returning response
  worker.send("test");

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("coupleWebSocket: forwards binary messages from worker to client", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  worker.send(viewToBuffer(utf8Encode("test")));
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.is(utf8Decode(event.data), "test");
});
test("coupleWebSocket: closes client socket on worker close", async (t) => {
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
  await coupleWebSocket(ws, client);
  worker.close(1000, "Test Closure");

  const event = await eventPromise;
  t.is(event.code, 1000);
  t.is(event.reason, "Test Closure");
});
test("coupleWebSocket: closes client socket on worker close with no close code", async (t) => {
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
  await coupleWebSocket(ws, client);
  worker.close();

  const event = await eventPromise;
  t.is(event.code, 1005);
});
test("coupleWebSocket: closes client socket on abnormal worker close", async (t) => {
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
  await coupleWebSocket(ws, client);
  worker[_kClose](1006); // 1006 is not allowed by worker.close()

  const event = await eventPromise;
  t.is(event.code, 1006);
});

test("coupleWebSocket: accepts worker socket immediately if already open", async (t) => {
  const [eventTrigger, eventPromise] = triggerPromise<{ data: any }>();
  const server = await useServer(t, noop, (ws) => {
    ws.addEventListener("message", eventTrigger);
  });
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Send before coupling, simulates sending message in worker code before returning response
  worker.send("test");
  // Make sure socket is open before terminating
  const [openTrigger, openPromise] = triggerPromise<WebSocketEvent>();
  ws.addEventListener("open", openTrigger);
  await openPromise;
  await coupleWebSocket(ws, client);

  const event = await eventPromise;
  t.is(event.data, "test");
});
test("coupleWebSocket: throws if web socket already closed", async (t) => {
  const server = await useServer(t, noop, noop);
  const ws = new StandardWebSocket(server.ws);
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  // Make sure socket is open before closing
  const [openTrigger, openPromise] = triggerPromise<WebSocketEvent>();
  ws.addEventListener("open", openTrigger);
  await openPromise;
  // Make sure socket is closed before terminating
  ws.close(1000, "Test Closure");
  await t.throwsAsync(coupleWebSocket(ws, client), {
    instanceOf: Error,
    message: "Incoming WebSocket connection already closed.",
  });
});
