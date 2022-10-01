import { AnalyticsEngine } from "@miniflare/analytics-engine";
import { Storage } from "@miniflare/shared";
import { testClock } from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";
import analytics from "../src/analytics";
import buildSQLFunctions from "../src/functions";

interface Context {
  storage: Storage;
  db: AnalyticsEngine;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach(async (t) => {
  const storage = new MemoryStorage(undefined, testClock);
  const sqliteDB = await storage.getSqliteDatabase(
    analytics.replaceAll("{{BINDING}}", "TEST_BINDING")
  );
  buildSQLFunctions(sqliteDB);
  const db = new AnalyticsEngine("TEST_BINDING", sqliteDB);
  t.context = { storage, db };
});

test("Analytics Engine: Write a data point using indexes, blobs, and doubles.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  await db.writeDataPoint({
    indexes: ["t1"],
    blobs: ["a", "b", "c"],
    doubles: [0, 1, 2],
  });

  // grab data from sqliteDB
  const stmt = sqliteDB.prepare("SELECT * FROM TEST_BINDING WHERE index1 = ?");
  const res = stmt.get("t1");
  t.true(typeof res.timestamp === "string");
  delete res.timestamp;
  t.deepEqual(res, {
    dataset: "TEST_BINDING",
    index1: "t1",
    _sample_interval: 1,
    blob1: "a",
    blob2: "b",
    blob3: "c",
    blob4: null,
    blob5: null,
    blob6: null,
    blob7: null,
    blob8: null,
    blob9: null,
    blob10: null,
    blob11: null,
    blob12: null,
    blob13: null,
    blob14: null,
    blob15: null,
    blob16: null,
    blob17: null,
    blob18: null,
    blob19: null,
    blob20: null,
    double1: 0,
    double2: 1,
    double3: 2,
    double4: null,
    double5: null,
    double6: null,
    double7: null,
    double8: null,
    double9: null,
    double10: null,
    double11: null,
    double12: null,
    double13: null,
    double14: null,
    double15: null,
    double16: null,
    double17: null,
    double18: null,
    double19: null,
    double20: null,
  });
});

test("Analytics Engine: Write a data point with no data provided.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  await db.writeDataPoint({});

  // grab data from sqliteDB
  const stmt = sqliteDB.prepare("SELECT * FROM TEST_BINDING");
  const res = stmt.get();
  t.true(typeof res.timestamp === "string");
  delete res.timestamp;
  t.deepEqual(res, {
    dataset: "TEST_BINDING",
    index1: null,
    _sample_interval: 1,
    blob1: null,
    blob2: null,
    blob3: null,
    blob4: null,
    blob5: null,
    blob6: null,
    blob7: null,
    blob8: null,
    blob9: null,
    blob10: null,
    blob11: null,
    blob12: null,
    blob13: null,
    blob14: null,
    blob15: null,
    blob16: null,
    blob17: null,
    blob18: null,
    blob19: null,
    blob20: null,
    double1: null,
    double2: null,
    double3: null,
    double4: null,
    double5: null,
    double6: null,
    double7: null,
    double8: null,
    double9: null,
    double10: null,
    double11: null,
    double12: null,
    double13: null,
    double14: null,
    double15: null,
    double16: null,
    double17: null,
    double18: null,
    double19: null,
    double20: null,
  });
});

test("Analytics Engine: Write a data point filling indexes, blobs, and doubles.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  await db.writeDataPoint({
    indexes: ["t1"],
    blobs: [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
    ],
    doubles: [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ],
  });

  // grab data from sqliteDB
  const stmt = sqliteDB.prepare("SELECT * FROM TEST_BINDING WHERE index1 = ?");
  const res = stmt.get("t1");
  t.true(typeof res.timestamp === "string");
  delete res.timestamp;
  t.deepEqual(res, {
    dataset: "TEST_BINDING",
    index1: "t1",
    _sample_interval: 1,
    blob1: "a",
    blob2: "b",
    blob3: "c",
    blob4: "d",
    blob5: "e",
    blob6: "f",
    blob7: "g",
    blob8: "h",
    blob9: "i",
    blob10: "j",
    blob11: "k",
    blob12: "l",
    blob13: "m",
    blob14: "n",
    blob15: "o",
    blob16: "p",
    blob17: "q",
    blob18: "r",
    blob19: "s",
    blob20: "t",
    double1: 0,
    double2: 1,
    double3: 2,
    double4: 3,
    double5: 4,
    double6: 5,
    double7: 6,
    double8: 7,
    double9: 8,
    double10: 9,
    double11: 10,
    double12: 11,
    double13: 12,
    double14: 13,
    double15: 14,
    double16: 15,
    double17: 16,
    double18: 17,
    double19: 18,
    double20: 19,
  });
});

test("Analytics Engine: Store AB", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  const blob1 = Buffer.from("test string", "utf-8");

  await db.writeDataPoint({
    indexes: ["t1"],
    blobs: [new Uint8Array(blob1).buffer],
  });

  const stmt = sqliteDB.prepare(
    "SELECT blob1 FROM TEST_BINDING WHERE index1 = ?"
  );
  const res = stmt.get("t1");
  t.is(res.blob1, "test string");
});

// https://developers.cloudflare.com/analytics/analytics-engine/get-started/
test("Analytics Engine: Minimal example test.", async (t) => {
  const { db, storage } = t.context;
  // @ts-expect-error: protected but does exist
  const { sqliteDB } = storage;

  await db.writeDataPoint({
    indexes: ["a3cd45"], // Sensor ID
    blobs: ["Seattle", "USA", "pro_sensor_9000"],
    doubles: [25, 0.5],
  });

  // BASIC MANIPULATION

  // grab data from sqliteDB
  const stmt = sqliteDB.prepare(
    "SELECT blob1 AS city, SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_humidity FROM TEST_BINDING WHERE double1 > 0 GROUP BY city ORDER BY avg_humidity DESC LIMIT 10"
  );
  const res = stmt.get();
  delete res.timestamp;
  t.deepEqual(res, {
    avg_humidity: 25,
    city: "Seattle",
  });

  // USING TIME SERIES DATA
  const stmt2 = sqliteDB.prepare(
    "SELECT intDiv(toUInt32(timestamp), 300) * 300 AS t, blob1 AS city, SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_humidity FROM TEST_BINDING WHERE timestamp >= NOW() AND double1 > 0 GROUP BY t, city ORDER BY t, avg_humidity DESC"
  );
  const res2 = stmt2.get();
  // console.log("res2", res2);
  t.is(typeof res2.t, "number");
  t.is(res2.avg_humidity, 25);
  t.is(res2.city, "Seattle");
});

test("Analytics Engine: More than one index fails.", async (t) => {
  const { db } = t.context;

  await t.throwsAsync(
    async () => {
      await db.writeDataPoint({
        indexes: ["t1", "t2"],
        blobs: ["a", "b", "c"],
        doubles: [0, 1, 2],
      });
    },
    {
      message: '"indexes" can not have more than one element.',
    }
  );
});

test("Analytics Engine: More than twenty blobs fails.", async (t) => {
  const { db } = t.context;

  await t.throwsAsync(
    async () => {
      await db.writeDataPoint({
        indexes: ["t1"],
        blobs: [
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
          "11",
          "12",
          "13",
          "14",
          "15",
          "16",
          "17",
          "18",
          "19",
          "20",
          "21",
        ],
      });
    },
    {
      message: '"blobs" array must contain less than or equal to 20 elements.',
    }
  );
});

test("Analytics Engine: More than twenty doubles fails.", async (t) => {
  const { db } = t.context;

  await t.throwsAsync(
    async () => {
      await db.writeDataPoint({
        indexes: ["t1"],
        doubles: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
          20, 21,
        ],
      });
    },
    {
      message:
        '"doubles" array must contain less than or equal to 20 elements.',
    }
  );
});

test("Analytics Engine: More than 50kB of blob data fails.", async (t) => {
  const { db } = t.context;

  const blob1 = Buffer.alloc(50_000);
  const blob2 = Buffer.alloc(5);

  await t.throwsAsync(
    async () => {
      await db.writeDataPoint({
        indexes: ["t1"],
        blobs: [new Uint8Array(blob1).buffer, new Uint8Array(blob2).buffer],
      });
    },
    {
      message: '"blobs" total size must be less than 50kB.',
    }
  );
});
