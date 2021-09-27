import { WebSocket, WebSocketPair } from "@miniflare/web-sockets";
import test from "ava";

test("WebSocket: can accept multiple times", (t) => {
  const webSocket = new WebSocket();
  webSocket.accept();
  webSocket.accept();
  t.pass();
});
test("WebSocket: sends message to pair", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());
  webSocket1.accept();
  webSocket2.accept();

  const messages1: (string | ArrayBuffer)[] = [];
  const messages2: (string | ArrayBuffer)[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.send("from1");
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, ["from1"]);
  webSocket2.send("from2");
  t.deepEqual(messages1, ["from2"]);
  t.deepEqual(messages2, ["from1"]);
});
test("WebSocket: queues messages if pair not accepted", (t) => {
  const [webSocket1, webSocket2] = Object.values(new WebSocketPair());

  const messages1: (string | ArrayBuffer)[] = [];
  const messages2: (string | ArrayBuffer)[] = [];
  webSocket1.addEventListener("message", (e) => messages1.push(e.data));
  webSocket2.addEventListener("message", (e) => messages2.push(e.data));

  webSocket1.accept();
  webSocket1.send("from1_1");
  t.deepEqual(messages1, []);
  t.deepEqual(messages2, []);

  webSocket2.accept();
  webSocket2.send("from2_1");
  t.deepEqual(messages1, ["from2_1"]);
  t.deepEqual(messages2, ["from1_1"]);

  webSocket1.send("from1_2");
  webSocket2.send("from2_2");
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
