import { AnalyticsEngine } from "@miniflare/analytics-engine";
import { Storage } from "@miniflare/shared";
import { testClock } from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";
import { isDate } from "../src/functions";

interface Context {
  storage: Storage;
  db: AnalyticsEngine;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach(async (t) => {
  const storage = new MemoryStorage(undefined, testClock);
  const db = new AnalyticsEngine(
    "TEST_BINDING",
    await storage.getSqliteDatabase()
  );
  t.context = { storage, db };
});

test("Analytics Engine: Test each function to ensure they work.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  await db.writeDataPoint({
    indexes: ["a3cd45"], // Sensor ID
    blobs: ["input"],
    doubles: [0.5, 1, 50, 1_000, 10_000],
  });

  // BASIC MANIPULATION

  // test IF -> true
  const stmt1 = sqliteDB.prepare(
    "SELECT IF(double1 < 10, 'true', 'false') AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res1 = stmt1.get("a3cd45");
  t.is(res1.answer, "true");

  // test IF -> false
  const stmt2 = sqliteDB.prepare(
    "SELECT IF(double1 > 10, 'true', 'false') AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res2 = stmt2.get("a3cd45");
  t.is(res2.answer, "false");

  // test INTDIV
  const stmt3 = sqliteDB.prepare(
    "SELECT INTDIV(50, 5) AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res3 = stmt3.get("a3cd45");
  t.is(res3.answer, 10);

  // test INTDIV as a float (7 / 4 = 1.75 (rounds down to 1))
  const stmt4 = sqliteDB.prepare(
    "SELECT INTDIV(7, 4) AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res4 = stmt4.get("a3cd45");
  t.is(res4.answer, 1);

  // test TOUINT32
  const stmt5 = sqliteDB.prepare(
    "SELECT TOUINT32(double3) AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res5 = stmt5.get("a3cd45");
  t.is(res5.answer, 50);

  // test INTDIV and TOUINT32 together
  const stmt6 = sqliteDB.prepare(
    "SELECT INTDIV(TOUINT32(double4), 5) AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res6 = stmt6.get("a3cd45");
  t.is(res6.answer, 200);

  // test TODATETIME
  const stmt7 = sqliteDB.prepare(
    "SELECT TODATETIME(0) AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res7 = stmt7.get("a3cd45");
  t.is(res7.answer, "1969-12-31 19:00:00");

  // test NOW
  const stmt8 = sqliteDB.prepare(
    "SELECT NOW() AS answer FROM TEST_BINDING WHERE index1 = ?"
  );
  const res8 = stmt8.get("a3cd45");
  t.true(isDate(res8.answer));

  // // test INTERVAL
  // const stmt9 = sqliteDB.prepare(
  //   "SELECT INTERVAL 42 DAY AS answer FROM TEST_BINDING WHERE index1 = ?"
  // );
  // const res9 = stmt9.get("a3cd45");
  // t.true(isDate(res9.answer));
});
