addEventListener("fetch", (e) => {
  e.respondWith(
    (() => {
      throw new Error("test");
    })()
  );
});
