import { expect, test } from "vitest";
setupMiniflareIsolatedStorage();

test("auto-loads package.json and wrangler.toml", async () => {
  const { OBJECT } = getMiniflareBindings();
  const id = OBJECT.newUniqueId();
  const stub = OBJECT.get(id);
  const res = await stub.fetch("https://object/");
  expect(await res.text()).toBe("test");
});

test("auto-loads .env", () => {
  const { ENV_KEY } = getMiniflareBindings();
  expect(ENV_KEY).toBe("value");
});
