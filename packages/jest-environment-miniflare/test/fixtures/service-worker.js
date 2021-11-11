export function handleRequest(request) {
  return new Response(`body:${request.url}`);
}

export function handleWebSocketRequest() {
  const [client, worker] = Object.values(new WebSocketPair());

  worker.accept();
  worker.addEventListener("message", (event) => {
    worker.send(`echo:${event.data}`);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});
