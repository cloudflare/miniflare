import worker from "./module-worker";

test("handles requests", async () => {
  const res = await worker.fetch(new Request("http://localhost/"));
  expect(await res.text()).toBe("fetch:http://localhost/");
});

test("handles requests with mocked upstream", async () => {
  const mockAgent = getMiniflareFetchMock();
  mockAgent.disableNetConnect();
  const client = mockAgent.get("https://random.mf");
  client.intercept({ path: "/" }).reply(200, "Hello World!");
  const res = await worker.fetch(new Request("https://random.mf"), true);
  expect(await res.text()).toBe("Hello World!");
});
