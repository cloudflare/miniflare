import assert from "assert";
import { Blob } from "buffer";
import { URLSearchParams } from "url";
import { noop, triggerPromise, useServer } from "@miniflare/shared-test";
import { upgradingFetch } from "@miniflare/web-sockets";
import test from "ava";
import { FormData } from "undici";

test("upgradingFetch: performs regular http request", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const res = await upgradingFetch(upstream);
  t.is(await res.text(), "upstream");
});
test("upgradingFetch: performs http request with form data", async (t) => {
  const echoUpstream = (
    await useServer(t, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.end(body));
    })
  ).http;
  const body = new FormData();
  body.append("a", "1");
  body.append("b", new URLSearchParams({ x: "1", y: "2", z: "3" }));
  body.append("c", new Blob(["abc"]), "file.txt");
  const res = await upgradingFetch(echoUpstream, { method: "POST", body });
  const text = await res.text();
  t.regex(text, /Content-Disposition: form-data; name="a"\r\n\r\n1/);
  t.regex(text, /Content-Disposition: form-data; name="b"\r\n\r\nx=1&y=2&z=3/);
  t.regex(
    text,
    /Content-Disposition: form-data; name="c"; filename="file.txt"\r\nContent-Type: application\/octet-stream\r\n\r\nabc/
  );
});
test("upgradingFetch: performs web socket upgrade", async (t) => {
  const server = await useServer(t, noop, (ws, req) => {
    ws.send("hello client");
    ws.send(req.headers["user-agent"]);
    ws.addEventListener("message", ({ data }) => ws.send(data));
  });
  const res = await upgradingFetch(server.http, {
    headers: { upgrade: "websocket", "user-agent": "Test" },
  });
  const webSocket = res.webSocket;
  t.not(webSocket, undefined);
  assert(webSocket);

  const [eventTrigger, eventPromise] = triggerPromise<void>();
  const messages: (string | ArrayBuffer)[] = [];
  webSocket.addEventListener("message", (e) => {
    messages.push(e.data);
    if (e.data === "hello server") eventTrigger();
  });
  webSocket.accept();
  webSocket.send("hello server");

  await eventPromise;
  t.deepEqual(messages, ["hello client", "Test", "hello server"]);
});
test("upgradingFetch: throws on ws(s) protocols", async (t) => {
  await t.throwsAsync(
    upgradingFetch("ws://localhost/", {
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message:
        "Fetch API cannot load: ws://localhost/.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.",
    }
  );
  await t.throwsAsync(
    upgradingFetch("wss://localhost/", {
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message:
        "Fetch API cannot load: wss://localhost/.\nMake sure you're using http(s):// URLs for WebSocket requests via fetch.",
    }
  );
});
test("upgradingFetch: requires GET for web socket upgrade", async (t) => {
  const server = await useServer(
    t,
    (req, res) => {
      t.is(req.method, "POST");
      res.end("http response");
    },
    () => t.fail()
  );
  await t.throwsAsync(
    upgradingFetch(server.http, {
      method: "POST",
      headers: { upgrade: "websocket" },
    }),
    {
      instanceOf: TypeError,
      message: "fetch failed",
    }
  );
});
