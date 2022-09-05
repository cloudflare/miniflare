import { beforeAll, expect, test } from "vitest";
setupMiniflareIsolatedStorage();

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
