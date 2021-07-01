addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const { respond } = wasm_bindgen;
  await wasm_bindgen(wasm);
  return new Response(respond(request.url));
}
