import { AnalyticsEngine, _prepare } from "@miniflare/analytics-engine";
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
    "TEST_DATASET",
    await storage.getSqliteDatabase()
  );
  t.context = { storage, db };
});

test("Analytics Engine: Test each function to ensure they work.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  db.writeDataPoint({
    indexes: ["a3cd45"], // Sensor ID
    blobs: ["input"],
    doubles: [0.5, 1, 50, 1_000, 10_000],
  });

  // BASIC MANIPULATION

  // test IF -> true
  const stmt1 = sqliteDB.prepare(
    "SELECT IF(double1 < 10, 'true', 'false') AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res1 = stmt1.get("a3cd45");
  t.is(res1.answer, "true");

  // test IF -> false
  const stmt2 = sqliteDB.prepare(
    "SELECT IF(double1 > 10, 'true', 'false') AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res2 = stmt2.get("a3cd45");
  t.is(res2.answer, "false");

  // test INTDIV
  const stmt3 = sqliteDB.prepare(
    "SELECT INTDIV(50, 5) AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res3 = stmt3.get("a3cd45");
  t.is(res3.answer, 10);

  // test INTDIV as a float (7 / 4 = 1.75 (rounds down to 1))
  const stmt4 = sqliteDB.prepare(
    "SELECT INTDIV(7, 4) AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res4 = stmt4.get("a3cd45");
  t.is(res4.answer, 1);

  // test TOUINT32
  const stmt5 = sqliteDB.prepare(
    "SELECT TOUINT32(double3) AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res5 = stmt5.get("a3cd45");
  t.is(res5.answer, 50);

  // test INTDIV and TOUINT32 together
  const stmt6 = sqliteDB.prepare(
    "SELECT INTDIV(TOUINT32(double4), 5) AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res6 = stmt6.get("a3cd45");
  t.is(res6.answer, 200);

  // test TODATETIME
  const stmt7 = sqliteDB.prepare(
    "SELECT TODATETIME(0) AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res7 = stmt7.get("a3cd45");
  t.is(res7.answer, "1969-12-31 19:00:00");

  // test NOW
  const stmt8 = sqliteDB.prepare(
    "SELECT NOW() AS answer FROM TEST_DATASET WHERE index1 = ?"
  );
  const res8 = stmt8.get("a3cd45");
  t.true(isDate(res8.answer));

  // test INTERVAL
  const stmt9Input = _prepare(
    "SELECT INTERVAL 42 DAY AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt9 = sqliteDB.prepare(stmt9Input);
  const res9 = stmt9.get("a3cd45");
  t.is(res9.answer, 42 * 60 * 60 * 24);

  // test INTERVAL with comments
  const stmt10Input = _prepare(
    "SELECT INTERVAL '42' DAY AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt10 = sqliteDB.prepare(stmt10Input);
  const res10 = stmt10.get("a3cd45");
  t.is(res10.answer, 42 * 60 * 60 * 24);

  // test INTERVAL with comments 2
  const stmt11Input = _prepare(
    "SELECT INTERVAL 42 'DAY' AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt11 = sqliteDB.prepare(stmt11Input);
  const res11 = stmt11.get("a3cd45");
  t.is(res11.answer, 42 * 60 * 60 * 24);

  // test INTERVAL with comments 3
  const stmt12Input = _prepare(
    "SELECT INTERVAL '42 DAY' AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt12 = sqliteDB.prepare(stmt12Input);
  const res12 = stmt12.get("a3cd45");
  t.is(res12.answer, 42 * 60 * 60 * 24);

  // test INTERVAL SECOND
  const stmt13Input = _prepare(
    "SELECT INTERVAL 42 SECOND AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt13 = sqliteDB.prepare(stmt13Input);
  const res13 = stmt13.get("a3cd45");
  t.is(res13.answer, 42);

  // test INTERVAL MINUTE
  const stmt14Input = _prepare(
    "SELECT INTERVAL 42 MINUTE AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt14 = sqliteDB.prepare(stmt14Input);
  const res14 = stmt14.get("a3cd45");
  t.is(res14.answer, 42 * 60);

  // test INTERVAL HOUR
  const stmt15Input = _prepare(
    "SELECT INTERVAL 42 HOUR AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt15 = sqliteDB.prepare(stmt15Input);
  const res15 = stmt15.get("a3cd45");
  t.is(res15.answer, 42 * 60 * 60);

  // test INTERVAL MONTH
  const stmt16Input = _prepare(
    "SELECT INTERVAL 2 MONTH AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt16 = sqliteDB.prepare(stmt16Input);
  const res16 = stmt16.get("a3cd45");
  t.is(res16.answer, 2 * 2_629_746);

  // test INTERVAL YEAR
  const stmt17Input = _prepare(
    "SELECT INTERVAL 2 YEAR AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt17 = sqliteDB.prepare(stmt17Input);
  const res17 = stmt17.get("a3cd45");
  t.is(res17.answer, 2 * 31_556_952);

  // test INTERVAL BAD INPUT
  const stmt18Input = _prepare(
    "SELECT INTERVAL 1 UNKNOWN AS answer FROM TEST_DATASET WHERE index1 = ?"
  )[0];
  const stmt18 = sqliteDB.prepare(stmt18Input);
  const res18 = stmt18.get("a3cd45");
  t.is(res18.answer, null);
});

test("Analytics Engine: Test quantileWeighted.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  db.writeDataPoint({
    indexes: ["qw"], // Sensor ID
    blobs: ["input"],
    doubles: [0, 3],
  });
  db.writeDataPoint({
    indexes: ["qw"], // Sensor ID
    blobs: ["input"],
    doubles: [2, 1],
  });
  db.writeDataPoint({
    indexes: ["qw"], // Sensor ID
    blobs: ["input"],
    doubles: [5, 4],
  });
  db.writeDataPoint({
    indexes: ["qw"], // Sensor ID
    blobs: ["input"],
    doubles: [1, 2],
  });

  // QUANTILEWEIGHTED with and without a space between "("
  const stmt = sqliteDB.prepare(
    _prepare(
      "SELECT QUANTILEWEIGHTED(0.5, double1, double2) AS answer FROM TEST_DATASET WHERE index1 = ?"
    )[0]
  );
  const res = stmt.get("qw");
  t.is(res.answer, 1);

  const stmt2 = sqliteDB.prepare(
    _prepare(
      "SELECT QUANTILEWEIGHTED (0.5, double1, double2) AS answer FROM TEST_DATASET WHERE index1 = ?"
    )[0]
  );
  const res2 = stmt2.get("qw");
  t.is(res2.answer, 1);
});
