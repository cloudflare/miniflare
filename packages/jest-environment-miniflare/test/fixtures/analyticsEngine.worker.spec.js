async function get() {
  // return fetch("http://localhost/cdn-cgi/mf/analytics_engine/sql", {
  //   method: "POST",
  //   body: "SELECT value FROM entries LIMIT 1;",
  // }).then(async (b) => await b.json());
  return queryMiniflareAnalyticsEngine(
    "SELECT dataset, blob1, blob2, blob3, double1, double2, double3 FROM AE_TEST_DB LIMIT 1;"
  );
}

test("AE test 1", async () => {
  await AE_TEST_DB.writeDataPoint({
    blobs: ["a", "b", "c"],
    doubles: [0, 1, 2],
  });
  expect(await get()).toMatchObject({
    dataset: "AE_TEST_DB",
    blob1: "a",
    blob2: "b",
    blob3: "c",
    double1: 0,
    double2: 1,
    double3: 2,
  });
});
