import { TestObject } from "./module-worker.js";

beforeAll(async () => {
  const { TEST_OBJECT } = getMiniflareBindings();
  const id = TEST_OBJECT.idFromName("test");
  const storage = await getMiniflareDurableObjectStorage(id);
  await storage.put("test", "value");
});

test("Durable Objects", async () => {
  const { TEST_OBJECT } = getMiniflareBindings();
  const id = TEST_OBJECT.idFromName("test");
  const stub = TEST_OBJECT.get(id);
  const res = await stub.fetch("https://object/");
  expect(await res.text()).toBe("durable:https://object/:value");
});

test("Durable Objects direct", async () => {
  // https://github.com/cloudflare/miniflare/issues/157
  const env = getMiniflareBindings();
  const id = env.TEST_OBJECT.idFromName("test");
  const state = await getMiniflareDurableObjectState(id);
  const object = new TestObject(state, env);
  const res = await object.fetch(new Request("https://object/"));
  expect(await res.text()).toBe("durable:https://object/:value");
});
