import { expect, test } from "vitest";
setupMiniflareIsolatedStorage();

test("fetch mock", async () => {
  const fetchMock = getMiniflareFetchMock();

  fetchMock.disableNetConnect();
  fetchMock
    .get("https://example.com")
    .intercept({ path: "/" })
    .reply(200, "body");

  const response = await fetch("https://example.com");
  expect(await response.text()).toBe("body");
});
