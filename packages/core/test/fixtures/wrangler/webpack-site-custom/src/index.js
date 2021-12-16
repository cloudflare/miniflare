addEventListener("fetch", (event) => {
  event.respondWith(new Response(`webpack-site-custom:${event.request.url}`));
});
