---
order: 4
---

# ✉️ WebSockets

- [WebSockets Reference](https://developers.cloudflare.com/workers/runtime-apis/websockets)
- [Using WebSockets](https://developers.cloudflare.com/workers/learning/using-websockets)

## Server

Miniflare will always upgrade Web Socket connections. The worker must respond
with a status `101 Switching Protocols` response including a `webSocket`. For
example, the worker below implements an echo WebSocket server:

```js
export default {
  fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());

    server.accept();
    server.addEventListener("message", (event) => {
      server.send(event.data);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
```

When using `dispatchFetch`, you are responsible for handling WebSockets by using
the `webSocket` property on `Response`. As an example, if the above worker
script was stored in `echo.mjs`:

```js
---
highlight: [11,12,13,14,15]
---
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  scriptPath: "echo.mjs",
});

const res = await mf.dispatchFetch();

const webSocket = res.webSocket;
webSocket.accept();
webSocket.addEventListener("message", (event) => {
  console.log(event.data);
});

webSocket.send("Hello!"); // Above listener logs "Hello!"
```

## Client

Miniflare also supports using workers as WebSocket clients too via `fetch` or
the
[standard `new WebSocket()` constructor](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket):

```js
---
highlight: [3,4,5]
---
export default {
  async fetch(request) {
    const res = await fetch("https://echo.websocket.org", {
      headers: { Upgrade: "websocket" },
    });

    const webSocket = res.webSocket;
    webSocket.accept();
    webSocket.addEventListener("message", (event) => {
      console.log(event.data);
    });

    webSocket.send("Hello!"); // Above listener logs "Hello!"

    return new Response();
  },
};
```

All WebSockets are automatically closed when the worker is reloaded.

## Validation

Like the real Workers runtime, Miniflare will throw errors when:

- Attempting to use a `WebSocket` in a `Response` that has already been used
- Attempting to use a `WebSocket` in a `Response` after calling `accept()` on it
- Attempting to call `WebSocket#send()` or `WebSocket#close()` without first
  calling `accept()`
- Attempting to call `WebSocket#send()` after calling `close()`
- Attempting to call `WebSocket#close()` on an already closed WebSocket
- Attempting to call `WebSocket#close()` with an invalid close code
