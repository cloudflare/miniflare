// noinspection JSUnusedLocalSymbols,JSUnusedAssignment

import { setImmediate } from "timers/promises";
import { DOMException } from "@miniflare/core";
import {
  RequestContext,
  RequestContextOptions,
  getRequestContext,
} from "@miniflare/shared";
import {
  TestInputGate,
  noop,
  triggerPromise,
  useServer,
  waitsForOutputGate,
} from "@miniflare/shared-test";
import {
  CloseEvent,
  MessageEvent,
  WebSocket,
  WebSocketPair,
  coupleWebSocket,
} from "@miniflare/web-sockets";
import test, { ExecutionContext } from "ava";
import StandardWebSocket from "ws";

test("WebSocket: can accept multiple times", (t) => {
  const [webSocket] = Object.values(new WebSocketPair());
  webSocket.accept();
  webSocket.accept();
  t.pass();
});
test("WebSocket: cannot accept if already coupled", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.send("test"));
  const ws = new StandardWebSocket(server.ws);
  const [webSocket1] = Object.values(new WebSocketPair());
  await coupleWebSocket(ws, webSocket1);
  t.throws(() => webSocket1.accept(), {
    instanceOf: TypeError,
    message: "Can't accept() WebSocket that was already used in a response.",
  });
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
test("WebSocket: must accept before sending", (t) => {
  const [webSocket1] = Object.values(new WebSocketPair());
  t.throws(() => webSocket1.send("test"), {
    instanceOf: TypeError,
    message:
      "You must call accept() on this WebSocket before sending messages.",
  });
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
test("WebSocket: queues closes if pair not accepted", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  let closeEvent1: CloseEvent | undefined;
  let closeEvent2: CloseEvent | undefined;
  webSocket1.addEventListener("close", (e) => (closeEvent1 = e));
  webSocket2.addEventListener("close", (e) => (closeEvent2 = e));

  webSocket1.accept();
  webSocket1.close(3001, "from1");
  await setImmediate();
  t.is(closeEvent1, undefined);
  t.is(closeEvent2, undefined);

  webSocket2.accept();
  t.is(closeEvent2?.code, 3001);
  t.is(closeEvent2?.reason, "from1");
  webSocket2.close(3002, "from2");
  await setImmediate();
  t.is(closeEvent1?.code, 3002);
  t.is(closeEvent1?.reason, "from2");
});
test("WebSocket: discards sent message to pair if other side closed", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  const messages1: (string | ArrayBuffer)[] = [];
  const messages2: (string | ArrayBuffer)[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.accept();
  webSocket2.accept();
  webSocket1.close();
  t.throws(() => webSocket1.send("from1"), {
    instanceOf: Error,
    message: "Can't call WebSocket send() after close().",
  });
  await setImmediate();
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, []);

  // Message sent from non-close()d side received
  webSocket2.send("from2");
  await setImmediate();
  t.deepEqual(messages1, ["from2"]);
  t.deepEqual(messages2, []);
});
test("WebSocket: closes both sides of pair", async (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const closes: number[] = [];
  webSocket1.addEventListener("close", () => closes.push(3));
  webSocket2.addEventListener("close", () => {
    closes.push(2);
    webSocket2.close();
  });
  closes.push(1);
  webSocket1.close();
  await setImmediate();

  // Check both event listeners called once
  t.deepEqual(closes, [1, 2, 3]);
});
test("WebSocket: has correct readyStates", async (t) => {
  // Check constants have correct values:
  // https://websockets.spec.whatwg.org/#interface-definition
  t.is(WebSocket.READY_STATE_CONNECTING, 0);
  t.is(WebSocket.READY_STATE_OPEN, 1);
  t.is(WebSocket.READY_STATE_CLOSING, 2);
  t.is(WebSocket.READY_STATE_CLOSED, 3);

  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  t.is(webSocket1.readyState, WebSocket.READY_STATE_OPEN);
  t.is(webSocket2.readyState, WebSocket.READY_STATE_OPEN);

  webSocket1.accept();
  webSocket2.accept();

  t.is(webSocket1.readyState, WebSocket.READY_STATE_OPEN);
  t.is(webSocket2.readyState, WebSocket.READY_STATE_OPEN);

  const [closeTrigger, closePromise] = triggerPromise<void>();
  webSocket1.addEventListener("close", () => {
    t.is(webSocket1.readyState, WebSocket.READY_STATE_CLOSED);
    t.is(webSocket2.readyState, WebSocket.READY_STATE_CLOSED);
    closeTrigger();
  });
  webSocket2.addEventListener("close", () => {
    t.is(webSocket1.readyState, WebSocket.READY_STATE_CLOSING);
    t.is(webSocket2.readyState, WebSocket.READY_STATE_CLOSING);
    webSocket2.close();
  });
  webSocket1.close();
  await closePromise;
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
test("WebSocket: must accept before closing", (t) => {
  const [webSocket1] = Object.values(new WebSocketPair());
  t.throws(() => webSocket1.close(), {
    instanceOf: TypeError,
    message:
      "You must call accept() on this WebSocket before sending messages.",
  });
});
test("WebSocket: can only call close once", (t) => {
  const [webSocket1] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket1.close(1000);
  t.throws(() => webSocket1.close(1000), {
    instanceOf: TypeError,
    message: "WebSocket already closed",
  });
});
test("WebSocket: validates close code", (t) => {
  const [webSocket1] = Object.values(new WebSocketPair());
  webSocket1.accept();
  // Try close with invalid code
  t.throws(() => webSocket1.close(1005 /*No Status Received*/), {
    instanceOf: TypeError,
    message: "Invalid WebSocket close code.",
  });
  // Try close with reason without code
  t.throws(() => webSocket1.close(undefined, "Test Closure"), {
    instanceOf: TypeError,
    message:
      "If you specify a WebSocket close reason, you must also specify a code.",
  });
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

  // Make sure we can construct a pair with `new`, and it returns instances of
  // the same class as the `new WebSocket()` constructor
  const [webSocket1] = Object.values(new WebSocketPair());
  // noinspection SuspiciousTypeOfGuard
  t.true(webSocket1 instanceof WebSocket);
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

// Test request context subrequest limits
function useSubrequest() {
  getRequestContext()?.incrementExternalSubrequests();
}
const ctxOpts: RequestContextOptions = {
  requestDepth: 5,
  pipelineDepth: 10,
  externalSubrequestLimit: 500,
};
function assertSubrequests(t: ExecutionContext, expected: number) {
  const ctx = getRequestContext();
  t.is(ctx?.externalSubrequests, expected);
  // Also check depths copied across
  t.is(ctx?.requestDepth, ctxOpts.requestDepth);
  t.is(ctx?.pipelineDepth, ctxOpts.pipelineDepth);
  t.is(ctx?.externalSubrequestLimit, ctxOpts.externalSubrequestLimit);
}
test("WebSocket: shares subrequest limit for WebSockets in regular worker handler", async (t) => {
  // Check WebSocket with both ends terminated in same worker handler
  await new RequestContext(ctxOpts).runWith(async () => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    webSocket2.accept();
    useSubrequest();
    const [trigger, promise] = triggerPromise<void>();
    webSocket1.addEventListener("message", () => {
      assertSubrequests(t, 1);
      trigger();
    });
    webSocket2.send("test");
    await promise;
  });

  // Check WebSocket with one end terminated in worker and one in client
  const [trigger, promise] = triggerPromise<void>();
  const webSocket2 = await new RequestContext(ctxOpts).runWith(async () => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    useSubrequest();
    webSocket1.addEventListener("message", () => {
      assertSubrequests(t, 1);
      trigger();
    });
    return webSocket2;
  });
  webSocket2.accept();
  webSocket2.send("test");
  await promise;
});
test("WebSocket: resets subrequest limit for WebSockets in Durable Object", async (t) => {
  // Check WebSocket with both ends terminated in same Durable Object
  const durableOpts: RequestContextOptions = {
    ...ctxOpts,
    durableObject: true,
  };
  await new RequestContext(durableOpts).runWith(async () => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    webSocket2.accept();
    useSubrequest();
    const [trigger, promise] = triggerPromise<void>();
    webSocket1.addEventListener("message", () => {
      assertSubrequests(t, 0);
      trigger();
    });
    webSocket2.send("test");
    await promise;
  });

  // Check WebSocket with one end terminated in Durable Object and one in fetch handler
  let [trigger, promise] = triggerPromise<void>();
  let webSocket2 = await new RequestContext(durableOpts).runWith(async () => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    useSubrequest();
    webSocket1.addEventListener("message", () => {
      assertSubrequests(t, 0);
      trigger();
    });
    return webSocket2;
  });
  new RequestContext(ctxOpts).runWith(() => {
    webSocket2.accept();
    webSocket2.send("test");
  });
  await promise;

  // Check WebSocket with one end terminated in Durable Object and one in client
  [trigger, promise] = triggerPromise<void>();
  webSocket2 = await new RequestContext(durableOpts).runWith(async () => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    useSubrequest();
    webSocket1.addEventListener("message", () => {
      assertSubrequests(t, 0);
      trigger();
    });
    return webSocket2;
  });
  webSocket2.accept();
  webSocket2.send("test");
  await promise;
});
test("WebSocket: resets subrequest limit for WebSockets outside worker", async (t) => {
  // Check WebSocket with one end terminate in fetch handler and one in test
  const webSocket2 = new RequestContext(ctxOpts).runWith(() => {
    const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
    webSocket1.accept();
    useSubrequest();
    webSocket1.send("test");
    return webSocket2;
  });
  const [trigger, promise] = triggerPromise<void>();
  webSocket2.accept();
  webSocket2.addEventListener("message", () => {
    const ctx = getRequestContext();
    t.is(ctx?.externalSubrequests, 0);
    // Depths should have default values in this case
    t.is(ctx?.requestDepth, 1);
    t.is(ctx?.pipelineDepth, 1);
    trigger();
  });
  await promise;
});

test("WebSocket: constructor: validates URL", (t) => {
  t.throws(() => new WebSocket("not a url"), {
    instanceOf: DOMException,
    name: "SyntaxError",
    message: "WebSocket Constructor: The url is invalid.",
  });
  t.throws(() => new WebSocket("http://localhost"), {
    instanceOf: DOMException,
    name: "SyntaxError",
    message: "WebSocket Constructor: The url scheme must be ws or wss.",
  });
  t.throws(() => new WebSocket("https://localhost"), {
    instanceOf: DOMException,
    name: "SyntaxError",
    message: "WebSocket Constructor: The url scheme must be ws or wss.",
  });
  t.throws(() => new WebSocket("wss://localhost/#hash"), {
    instanceOf: DOMException,
    name: "SyntaxError",
    message: "WebSocket Constructor: The url fragment must be empty.",
  });
});

test('WebSocket: constructor: send fails before "open" event emitted', async (t) => {
  const server = await useServer(t, noop, (ws) => {
    ws.send("hello client");
    ws.addEventListener("message", ({ data }) => ws.send(data));
  });

  const webSocket = new WebSocket(server.ws);
  t.is(webSocket.readyState, WebSocket.READY_STATE_CONNECTING);
  t.throws(() => webSocket.send("boo!"), {
    instanceOf: TypeError,
    message:
      "You must call accept() on this WebSocket before sending messages.",
  });

  webSocket.addEventListener("open", () => {
    t.is(webSocket.readyState, WebSocket.READY_STATE_OPEN);
    webSocket.send("hello server");
  });

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: (string | ArrayBuffer)[] = [];
  webSocket.addEventListener("message", (e) => {
    messages.push(e.data);
    if (e.data === "hello server") eventTrigger();
  });

  await eventPromise;
  t.deepEqual(messages, ["hello client", "hello server"]);
});
test("WebSocket: constructor: passes through protocols", async (t) => {
  const server = await useServer(t, noop, (ws, req) => {
    ws.send(req.headers["sec-websocket-protocol"]);
    ws.close();
  });

  let webSocket = new WebSocket(server.ws, "protocol");
  let [eventTrigger, eventPromise] = triggerPromise<MessageEvent>();
  webSocket.addEventListener("message", eventTrigger);
  let event = await eventPromise;
  t.is(event.data, "protocol");

  webSocket = new WebSocket(server.ws, ["protocol1", "protocol2"]);
  [eventTrigger, eventPromise] = triggerPromise<MessageEvent>();
  webSocket.addEventListener("message", eventTrigger);
  event = await eventPromise;
  t.is(event.data, "protocol1,protocol2");
});
test("WebSocket: constructor: cannot accept constructed sockets", async (t) => {
  const server = await useServer(t, noop, (ws) => ws.close());
  const webSocket = new WebSocket(server.ws);
  t.throws(() => webSocket.accept(), {
    instanceOf: TypeError,
    message:
      "Websockets obtained from the 'new WebSocket()' constructor cannot call accept",
  });
});
