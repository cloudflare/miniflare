import { jest } from "@jest/globals";
import { DurableObjectId } from "@miniflare/durable-objects";

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
  class Counter {
    constructor(state) {
      this.storage = state.storage;
    }
    async fetch() {
      const count = (await this.storage.get("count")) ?? 0;
      void this.storage.put("count", count + 1);
      return new Response(String(count));
    }
  }

  // https://github.com/cloudflare/miniflare/issues/157
  const env = getMiniflareBindings();
  // Doesn't matter too much that we're using a different object binding here
  const id = env.TEST_OBJECT.idFromName("test");
  const state = await getMiniflareDurableObjectState(id);
  const object = new Counter(state, env);
  const [res1, res2] = await Promise.all([
    runWithMiniflareDurableObjectGates(state, () =>
      object.fetch(new Request("https://object/"))
    ),
    runWithMiniflareDurableObjectGates(state, () =>
      object.fetch(new Request("https://object/"))
    ),
  ]);
  expect(await state.storage.get("count")).toBe(2);
  expect(await res1.text()).toBe("0");
  expect(await res2.text()).toBe("1");
});

test("Durable Objects list", async () => {
  const env = getMiniflareBindings();

  // From beforeAll
  expect(await getMiniflareDurableObjectIds("TEST_OBJECT")).toHaveLength(1);

  const id = env.TEST_OBJECT.idFromName("test");
  env.TEST_OBJECT.get(id);
  expect(await getMiniflareDurableObjectIds("TEST_OBJECT")).toHaveLength(1);
  expect((await getMiniflareDurableObjectIds("TEST_OBJECT"))[0]).toMatchObject(
    new DurableObjectId("TEST_OBJECT", id.toString())
  );

  const id2 = env.TEST_OBJECT.idFromName("test2");
  const stub = env.TEST_OBJECT.get(id2);
  await stub.fetch("https://object/");
  expect(await getMiniflareDurableObjectIds("TEST_OBJECT")).toHaveLength(2);
  expect((await getMiniflareDurableObjectIds("TEST_OBJECT"))[1]).toMatchObject(
    new DurableObjectId("TEST_OBJECT", id2.toString())
  );
});

test("Access to Durable Object instance", async () => {
  const env = getMiniflareBindings();
  const id = env.TEST_OBJECT.idFromName("test");
  const stub = env.TEST_OBJECT.get(id);
  const instance = await getMiniflareDurableObjectInstance(id);
  const fetch = jest.spyOn(instance, "fetch");

  await stub.fetch(new Request("https://object/"));

  expect(instance.constructor.name).toBe("TestObject");
  expect(fetch).toHaveBeenCalled();
});
