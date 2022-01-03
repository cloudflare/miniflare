test("auto-loads package.json and wrangler.toml", async () => {
  const { OBJECT } = getMiniflareBindings();
  const id = OBJECT.newUniqueId();
  const stub = OBJECT.get(id);
  const res = await stub.fetch("https://object/");
  expect(await res.text()).toBe("test");
});

test("respects proxy_primitive_instanceof option", async () => {
  // Should be auto-loaded from wrangler.toml
  const { OBJECT } = getMiniflareBindings();
  expect(OBJECT instanceof Object).toBe(true);
  expect({} instanceof Object).toBe(true);
});

test("auto-loads .env", () => {
  const { ENV_KEY } = getMiniflareBindings();
  expect(ENV_KEY).toBe("value");
});
