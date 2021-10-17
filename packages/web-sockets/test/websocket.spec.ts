// noinspection JSUnusedLocalSymbols,JSUnusedAssignment

import { setImmediate } from "timers/promises";
import {
  TestInputGate,
  triggerPromise,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import {
  CloseEvent,
  MessageEvent,
  WebSocket,
  WebSocketPair,
} from "@miniflare/web-sockets";
import test, { ExecutionContext } from "ava";

test("WebSocket: can accept multiple times", (t) => {
  const webSocket = new WebSocket();
  webSocket.accept();
  webSocket.accept();
  t.pass();
});
test("WebSocket: sends message to pair", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const messages1: (string | ArrayBuffer)[] = [];
  const messages2: (string | ArrayBuffer)[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.send("from1");
  await setImmediate();
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, ["from1"]);
  webSocket2.send("from2");
  await setImmediate();
  t.deepEqual(messages1, ["from2"]);
  t.deepEqual(messages2, ["from1"]);
});
test("WebSocket: queues messages if pair not accepted", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  const messages1: (string | ArrayBuffer)[] = [];
  const messages2: (string | ArrayBuffer)[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.accept();
  webSocket1.send("from1_1");
  await setImmediate();
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, []);

  webSocket2.accept();
  webSocket2.send("from2_1");
  await setImmediate();
  t.deepEqual(messages1, ["from2_1"]);
  t.deepEqual(messages2, ["from1_1"]);

  webSocket1.send("from1_2");
  webSocket2.send("from2_2");
  await setImmediate();
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
    message: "Can't call WebSocket send() after close().",
  });
  t.throws(() => webSocket2.send("from2"), {
    instanceOf: Error,
    message: "Can't call WebSocket send() after close().",
  });
});
test("WebSocket: closes both sides of pair", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const closes: number[] = [];
  webSocket1.addEventListener("close", () => closes.push(1));
  webSocket2.addEventListener("close", () => closes.push(2));

  webSocket1.close();
  await setImmediate();
  // Check both event listeners called once
  t.deepEqual(closes, [1, 2]);
});

test("WebSocket: waits for output gate to open before sending message", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  let event: MessageEvent | undefined;
  webSocket2.addEventListener("message", (e) => (event = e));
  await waitsForOutputGate(
    t,
    () => webSocket1.send("test"),
    () => event
  );
});
test("WebSocket: waits for output gate to open before closing", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  let event: CloseEvent | undefined;
  webSocket2.addEventListener("close", (e) => (event = e));
  await waitsForOutputGate(
    t,
    () => webSocket1.close(),
    () => event
  );
});
async function eventDispatchWaitsForInputGate(
  t: ExecutionContext,
  addEventListener: (listener: (event: unknown) => void) => void,
  dispatchEvent: () => void
): Promise<void> {
  const inputGate = new TestInputGate();
  const [openTrigger, openPromise] = triggerPromise<void>();
  const events: number[] = [];
  const promise = inputGate.runWith(() => {
    // Close input gate (inside runWith as runWith waits for gate to be open
    // before running closure, so would deadlock if already closed)
    // noinspection ES6MissingAwait
    void inputGate.runWithClosed(() => openPromise);
    return new Promise((resolve) => {
      addEventListener(resolve);
    }).then(() => events.push(1));
  });
  await setImmediate(); // Give enough time for addEventListener to be called
  dispatchEvent();
  await inputGate.waitedPromise;
  events.push(2);
  openTrigger();
  await promise;
  t.deepEqual(events, [2, 1]);
}
test("WebSocket: waits for input gate to open before receiving message", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();
  await eventDispatchWaitsForInputGate(
    t,
    (listener) => webSocket2.addEventListener("message", listener),
    () => webSocket1.send("test")
  );
});
test("WebSocket: waits for input gate to open before receiving close event", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();
  await eventDispatchWaitsForInputGate(
    t,
    (listener) => webSocket2.addEventListener("close", listener),
    () => webSocket1.close()
  );
});

test("WebSocketPair: requires 'new' operator to construct", (t) => {
  // @ts-expect-error this shouldn't type check
  t.throws(() => WebSocketPair(), {
    instanceOf: TypeError,
    message: /^Failed to construct 'WebSocketPair'/,
  });
});

// Test WebSocketPair types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function testWebSocketPairTypes() {
  const pair = new WebSocketPair();

  let [webSocket1, webSocket2] = Object.values(pair);

  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  [webSocket1, webSocket2] = pair;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  webSocket1 = pair[0];

  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  webSocket2 = pair[2];
}
