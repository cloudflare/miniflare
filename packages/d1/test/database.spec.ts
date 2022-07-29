import { BetaDatabase } from "@miniflare/d1";
import { Storage } from "@miniflare/shared";
import { testClock } from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";

interface Context {
  storage: Storage;
  db: BetaDatabase;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const storage = new MemoryStorage(undefined, testClock);
  const db = new BetaDatabase(storage);
  t.context = { storage, db };
});

test("batch, prepare & all", async (t) => {
  const { db } = t.context;

  await db.batch([
    db.prepare(
      `CREATE TABLE my_table (cid INTEGER PRIMARY KEY, name TEXT NOT NULL);`
    ),
  ]);
  const response = await db.prepare(`SELECT * FROM sqlite_schema`).all();
  t.deepEqual(Object.keys(response), [
    "results",
    "duration",
    "lastRowId",
    "changes",
    "success",
    "served_by",
  ]);
  t.deepEqual(response.results, [
    {
      type: "table",
      name: "my_table",
      tbl_name: "my_table",
      rootpage: 2,
      sql: "CREATE TABLE my_table (cid INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    },
  ]);
});
