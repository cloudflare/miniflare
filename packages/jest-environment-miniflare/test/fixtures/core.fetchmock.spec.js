import { handleRequestWithFetch } from "./service-worker";

test("handles requests", async () => {
  // Create a Mock Agent and prevent internet access - https://github.com/nodejs/undici/blob/main/docs/api/MockAgent.md
  const agent = await createMockAgent();
  agent.disableNetConnect();

  const client = agent.get("https://miniflare.dev");
  client.intercept({ path: "/", method: "GET" }).reply(200, "Hello World!");

  await setGlobalDispatcher(agent);

  const res = await handleRequestWithFetch(
    new Request("https://miniflare.dev")
  );
  // Check we have the mocked miniflare site and not the real one
  expect(await res.text()).toBe("Hello World!");
});
