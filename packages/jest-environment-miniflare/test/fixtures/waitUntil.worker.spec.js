function testResponse(body) {
  return new Response(body, { headers: { "Cache-Control": "max-age=3600" } });
}

test("FetchEvent: waitUntil: await resolving promise array using getMiniflareWaitUntil.", async () => {
  // build a FetchEvent:
  const url = "http://localhost/fetchEvent/waitUntil";
  const request = new Request(url);
  const fetchEvent = new FetchEvent("fetch", { request });

  // run a waitUntil
  fetchEvent.waitUntil(caches.default.put(url, testResponse("example cache")));

  // ensure that waitUntil has yet to be run
  let cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeUndefined();

  // pull in the waitUntil stack
  const waitUntilList = getMiniflareWaitUntil(fetchEvent);
  expect(waitUntilList).not.toBeNull();
  await Promise.all(waitUntilList);

  cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeTruthy();
  expect(await cachedResponse.text()).toBe("example cache");
});

test("ScheduledEvent: waitUntil: await resolving promise array using getMiniflareWaitUntil.", async () => {
  const url = "http://localhost/scheduledEvent/waitUntil";

  const scheduledEvent = new ScheduledEvent("scheduled", {
    scheduledTime: 1000,
    cron: "30 * * * *",
  });

  // run a waitUntil
  scheduledEvent.waitUntil(
    caches.default.put(url, testResponse("example cache"))
  );

  // ensure that waitUntil has yet to be run
  let cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeUndefined();

  // pull in the waitUntil stack
  const waitUntilList = getMiniflareWaitUntil(scheduledEvent);
  expect(waitUntilList).not.toBeNull();
  await Promise.all(waitUntilList);

  cachedResponse = await caches.default.match(url);
  expect(cachedResponse).toBeTruthy();
  expect(await cachedResponse.text()).toBe("example cache");
});
