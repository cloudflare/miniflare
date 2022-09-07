import { expect, test } from "vitest";
import worker from "./module-worker";
setupMiniflareIsolatedStorage();

test("handles requests", async () => {
  const res = await worker.fetch(new Request("http://localhost/"));
  expect(await res.text()).toBe("fetch:http://localhost/");
});

test("handles requests with mocked upstream", async () => {
  console.log(fetch.toString());

  const mockAgent = getMiniflareFetchMock();
  mockAgent.disableNetConnect();
  const client = mockAgent.get("https://random.mf");
  client.intercept({ path: "/" }).reply(200, "Hello World!");
  const res = await fetch(new Request("https://random.mf"));
  expect(await res.text()).toBe("Hello World!");
});
