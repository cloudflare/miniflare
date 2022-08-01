import worker from "./mock-worker";

test("handles requests", async () => {
  const mockAgent = getMiniflareFetchMock();
  mockAgent.disableNetConnect();
  const client = mockAgent.get("https://random.mf");
  client.intercept({ path: "/" }).reply(200, "Hello World!");
  await setMiniflareFetchMock(mockAgent);
  const res = await worker.fetch(new Request("https://random.mf"));
  expect(await res.text()).toBe("Hello World!");
});
