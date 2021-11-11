test("Workers Sites", async () => {
  const res = await __STATIC_CONTENT.get("test.txt");
  expect(res.trim()).toBe("test");
});
