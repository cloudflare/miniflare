import { beforeAll, expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

function testResponse(body) {
  return new Response(body, { headers: { "Cache-Control": "max-age=3600" } });
}

describe("default cache", () => {
  test("test 1", async () => {
    await caches.default.put("http://localhost/", testResponse("1"));
    const res = await caches.default.match("http://localhost/");
    expect(await res.text()).toBe("1");
  });

  test("test 2", async () => {
    // Shouldn't be able to see test 1's cached response
    const res = await caches.default.match("http://localhost/");
    expect(res).toBeUndefined();
  });
});

describe("named cache", () => {
  beforeAll(async () => {
    const cache = await caches.open("named");
    await cache.put("http://localhost/", testResponse("2"));
  });

  test("test 1", async () => {
    // Should be able to see beforeAll cached response
    const cache = await caches.open("named");
    let res = await cache.match("http://localhost/");
    expect(await res.text()).toBe("2");

    await cache.put("http://localhost/", testResponse("3"));
    res = await cache.match("http://localhost/");
    expect(await res.text()).toBe("3");
  });

  test("test 2", async () => {
    // Should be able to see beforeAll cached response, but not test 1's
    const cache = await caches.open("named");
    const res = await cache.match("http://localhost/");
    expect(await res.text()).toBe("2");
  });
});
