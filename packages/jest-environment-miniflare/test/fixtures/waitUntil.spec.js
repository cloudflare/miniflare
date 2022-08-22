test("FetchEvent: waitUntil: await resolving promise array using getMiniflareWaitUntil.", async () => {
  // build a FetchEvent:
  const url = "https://localhost/";
  const request = new Request(url);
  const fetchEvent = new FetchEvent("fetch", { request });

  // run a waitUntil
  fetchEvent.waitUntil(
    caches.default.put(url, new Response("written to cache"))
  );

  // pull in the waitUntil stack
  const waitUntilList = getMiniflareWaitUntil(fetchEvent);
  expect(waitUntilList).not.toBeNull();
  await Promise.allSettled(waitUntilList);

  const cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeTruthy();
  expect(await cachedResponse.text()).toBe("written to cache");
});

test("ScheduledEvent: waitUntil: await resolving promise array using getMiniflareWaitUntil.", async () => {
  const scheduledEvent = new ScheduledEvent("scheduled", {
    scheduledTime: 1000,
    cron: "30 * * * *",
  });

  // run a waitUntil
  scheduledEvent.waitUntil(
    caches.default.put(url, new Response("written to cache"))
  );

  // pull in the waitUntil stack
  const waitUntilList = getMiniflareWaitUntil(fetchEvent);
  expect(waitUntilList).not.toBeNull();
  await Promise.allSettled(waitUntilList);

  const cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeTruthy();
  expect(await cachedResponse.text()).toBe("written to cache");
});
