import worker from "./module-worker";

test("handles requests", async () => {
  const res = worker.fetch(new Request("http://localhost/"));
  expect(await res.text()).toBe("fetch:http://localhost/");
});
