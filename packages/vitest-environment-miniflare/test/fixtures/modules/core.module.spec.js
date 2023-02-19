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

test("reply callback options has expected data", async () => {
  const mockAgent = getMiniflareFetchMock();
  mockAgent.disableNetConnect();
  const client = mockAgent.get("https://random.mf");
  client.intercept({ path: "/", method: "POST" }).reply(200, (opts) => {
    return opts;
  });
  const res = await fetch("https://random.mf", {
    method: "POST",
    body: JSON.stringify({ foo: "bar" }),
  });
  expect(await res.json()).toEqual({
    body: '{"foo":"bar"}',
    headers: {
      "accept-encoding": "br, gzip, deflate",
      "content-length": "13",
      "content-type": "text/plain;charset=UTF-8",
      "MF-Loop": "1",
    },
    maxRedirections: 0,
    method: "POST",
    origin: "https://random.mf",
    path: "/",
  });
});
