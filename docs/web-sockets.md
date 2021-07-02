# ✉️ WebSockets

## Server

When using the CLI, or the `createServer` method, Miniflare will always upgrade
Web Socket connections. The worker must then respond with a status
`101 Switching Protocols` response with a `webSocket` set. For example, the
worker below implements an echo WebSocket server:

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
script is stored in `echo.mjs`:

```js{9-15}
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

Miniflare also supports using workers as WebSocket clients too via `fetch`:

```js{3-5}
export default {
  async fetch(request) {
    const res = await fetch("wss://echo.websocket.org", {
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
