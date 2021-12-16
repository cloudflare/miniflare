addEventListener("fetch", (event) => {
  event.respondWith(new Response(`webpack-site:${event.request.url}`));
});
