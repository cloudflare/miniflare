import { expect, test } from "vitest";

async function get() {
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
    meta: {
      dataset: "String",
      blob1: "String",
      blob2: "String",
      blob3: "String",
      double1: "Float64",
      double2: "Float64",
      double3: "Float64",
    },
    data: [
      {
        dataset: "AE_TEST_DB",
        blob1: "a",
        blob2: "b",
        blob3: "c",
        double1: 0,
        double2: 1,
        double3: 2,
      },
    ],
    rows: 1,
  });
});
