import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { D1Database, D1DatabaseAPI } from "@miniflare/d1";
import { Storage, createSQLiteDB } from "@miniflare/shared";
import { testClock, useTmp, utf8Encode } from "@miniflare/shared-test";
import { MemoryStorage } from "@miniflare/storage-memory";
import anyTest, { TestInterface } from "ava";

interface Context {
  storage: Storage;
  db: D1Database;
}

const test = anyTest as TestInterface<Context>;

const COLOUR_SCHEMA =
  "CREATE TABLE colours (id INTEGER PRIMARY KEY, name TEXT NOT NULL, rgb INTEGER NOT NULL);";
interface ColourRow {
  id: number;
  name: string;
  rgb: number;
}

const KITCHEN_SINK_SCHEMA =
  "CREATE TABLE kitchen_sink (id INTEGER PRIMARY KEY, int INTEGER, real REAL, text TEXT, blob BLOB);";
interface KitchenSinkRow {
  id: number;
  int: number | null;
  real: number | null;
  text: string | null;
  blob: number[] | null;
}

test.beforeEach(async (t) => {
  const storage = new MemoryStorage(undefined, testClock);
  const sqliteDb = await storage.getSqliteDatabase();

  // Seed data using `better-sqlite3` APIs
  sqliteDb.exec(COLOUR_SCHEMA);
  sqliteDb.exec(KITCHEN_SINK_SCHEMA);
  const insertColour = sqliteDb.prepare(
    "INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)"
  );
  insertColour.run(1, "red", 0xff0000);
  insertColour.run(2, "green", 0x00ff00);
  insertColour.run(3, "blue", 0x0000ff);

  const db = new D1Database(new D1DatabaseAPI(sqliteDb));
  t.context = { storage, db };
});

function throwCause<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error) => {
    assert.strictEqual(error.message, "D1_ERROR");
    assert.notStrictEqual(error.cause, undefined);
    throw error.cause;
  });
}

test("D1Database: dump", async (t) => {
  const { db } = t.context;
  const tmp = await useTmp(t);
  const buffer = await db.dump();

  // Load the dumped data as an SQLite database and try query it
  const tmpPath = path.join(tmp, "db.sqlite3");
  await fs.writeFile(tmpPath, new Uint8Array(buffer));
  const sqliteDb = await createSQLiteDB(tmpPath);
  const results = sqliteDb.prepare("SELECT name FROM colours").all();
  t.deepEqual(results, [{ name: "red" }, { name: "green" }, { name: "blue" }]);
});
test("D1Database: batch", async (t) => {
  const { db } = t.context;

  const insert = db.prepare(
    "INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)"
  );
  const batchResults = await db.batch<Pick<ColourRow, "name">>([
    insert.bind(4, "yellow", 0xffff00),
    db.prepare("SELECT name FROM colours"),
  ]);
  t.is(batchResults.length, 2);
  t.true(batchResults[0].success);
  t.deepEqual(batchResults[0].results, []);
  t.true(batchResults[1].success);
  const expectedResults = [
    { name: "red" },
    { name: "green" },
    { name: "blue" },
    { name: "yellow" },
  ];
  t.deepEqual(batchResults[1].results, expectedResults);

  // Check error mid-batch rolls-back entire batch
  const badInsert = db.prepare(
    "PUT IN colours (id, name, rgb) VALUES (?, ?, ?)"
  );
  await t.throwsAsync(
    throwCause(
      db.batch([
        insert.bind(5, "purple", 0xff00ff),
        badInsert.bind(6, "blurple", 0x5865f2),
        insert.bind(7, "cyan", 0x00ffff),
      ])
    ),
    { message: /syntax error/ }
  );
  const result = await db
    .prepare("SELECT name FROM colours")
    .all<Pick<ColourRow, "name">>();
  t.deepEqual(result.results, expectedResults);
});
test("D1Database: exec", async (t) => {
  const { db } = t.context;

  // Check with single statement
  let execResult = await db.exec(
    "UPDATE colours SET name = 'Red' WHERE name = 'red'"
  );
  t.is(execResult.count, 1);
  t.true(execResult.duration > 0);
  let result = await db
    .prepare("SELECT name FROM colours WHERE name = 'Red'")
    .all<Pick<ColourRow, "name">>();
  t.deepEqual(result.results, [{ name: "Red" }]);

  // Check with multiple statements
  const statements = [
    "UPDATE colours SET name = 'Green' WHERE name = 'green'",
    "UPDATE colours SET name = 'Blue' WHERE name = 'blue'",
  ].join("\n");
  execResult = await db.exec(statements);
  t.is(execResult.count, 2);
  t.true(execResult.duration > 0);
  result = await db.prepare("SELECT name FROM colours").all();
  t.deepEqual(result.results, [
    { name: "Red" },
    { name: "Green" },
    { name: "Blue" },
  ]);
});

test("D1PreparedStatement: bind", async (t) => {
  const { db } = t.context;

  // Check with all parameter types
  const blob = utf8Encode("Walshy");
  const blobArray = Array.from(blob);
  await db
    .prepare(
      "INSERT INTO kitchen_sink (id, int, real, text, blob) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(1, 42, 3.141, "🙈", blob)
    .run();
  let result = await db
    .prepare("SELECT * FROM kitchen_sink")
    .all<KitchenSinkRow>();
  t.deepEqual(result.results, [
    { id: 1, int: 42, real: 3.141, text: "🙈", blob: blobArray },
  ]);

  // Check with null values
  await db.prepare("UPDATE kitchen_sink SET blob = ?").bind(null).run();
  result = await db.prepare("SELECT * FROM kitchen_sink").all();
  t.deepEqual(result.results, [
    { id: 1, int: 42, real: 3.141, text: "🙈", blob: null },
  ]);

  // Check with multiple statements (should only bind first)
  const colourResults = await db
    .prepare(
      "SELECT * FROM colours WHERE name = ?; SELECT * FROM colours WHERE id = ?;"
    )
    .bind("green")
    .all<ColourRow>();
  t.is(colourResults.results?.length, 1);
});

// Lots of strange edge cases here...

test("D1PreparedStatement: first", async (t) => {
  const { db } = t.context;

  // Check with read statement
  const select = await db.prepare("SELECT * FROM colours");
  let result = await select.first<ColourRow>();
  t.deepEqual(result, { id: 1, name: "red", rgb: 0xff0000 });
  let id = await select.first<number>("id");
  t.is(id, 1);

  // Check with multiple statements (should only match on first statement)
  result = await db
    .prepare(
      "SELECT * FROM colours WHERE name = 'none'; SELECT * FROM colours WHERE id = 1;"
    )
    .first();
  t.is(result, null);

  // Check with write statement (should actually execute statement)
  result = await db
    .prepare("INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)")
    .bind(4, "yellow", 0xffff00)
    .first();
  t.is(result, null);
  id = await db
    .prepare("SELECT id FROM colours WHERE name = ?")
    .bind("yellow")
    .first("id");
  t.is(id, 4);
});
test("D1PreparedStatement: run", async (t) => {
  const { db } = t.context;

  // Check with read statement
  await t.throwsAsync(throwCause(db.prepare("SELECT * FROM colours").run()), {
    message: /Execute returned results - did you mean to call query\?/,
  });
  // Check with read/write statement
  await t.throwsAsync(
    throwCause(
      db
        .prepare(
          "INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?) RETURNING *"
        )
        .bind(4, "yellow", 0xffff00)
        .run()
    ),
    { message: /Execute returned results - did you mean to call query\?/ }
  );

  // Check with multiple statements (should only execute first statement)
  let result = await db
    .prepare(
      "INSERT INTO kitchen_sink (id) VALUES (1); INSERT INTO kitchen_sink (id) VALUES (2);"
    )
    .run();
  t.true(result.success);
  const results = await db
    .prepare("SELECT id FROM kitchen_sink")
    .all<Pick<KitchenSinkRow, "id">>();
  t.deepEqual(results.results, [{ id: 1 }]);

  // Check with write statement
  result = await db
    .prepare("INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)")
    .bind(4, "yellow", 0xffff00)
    .run();
  t.true(result.meta.duration > 0);
  t.deepEqual(result, {
    results: [],
    success: true,
    meta: {
      // Don't know duration, so just match on returned value asserted > 0
      duration: result.meta.duration,
      last_row_id: null,
      changes: null,
      served_by: "miniflare.db",
      internal_stats: null,
    },
  });
});
test("D1PreparedStatement: all", async (t) => {
  const { db } = t.context;

  // Check with read statement
  let result = await db.prepare("SELECT * FROM colours").all<ColourRow>();
  t.true(result.meta.duration > 0);
  t.deepEqual(result, {
    results: [
      { id: 1, name: "red", rgb: 0xff0000 },
      { id: 2, name: "green", rgb: 0x00ff00 },
      { id: 3, name: "blue", rgb: 0x0000ff },
    ],
    success: true,
    meta: {
      // Don't know duration, so just match on returned value asserted > 0
      duration: result.meta.duration,
      last_row_id: null,
      changes: null,
      served_by: "miniflare.db",
      internal_stats: null,
    },
  });

  // Check with multiple statements (should only return first statement results)
  result = await db
    .prepare(
      "SELECT * FROM colours WHERE id = 1; SELECT * FROM colours WHERE id = 3;"
    )
    .all<ColourRow>();
  t.deepEqual(result.results, [{ id: 1, name: "red", rgb: 0xff0000 }]);

  // Check with write statement (should actually execute, but return nothing)
  result = await db
    .prepare("INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)")
    .bind(4, "yellow", 0xffff00)
    .all();
  t.deepEqual(result.results, []);
  const id = await db
    .prepare("SELECT id FROM colours WHERE name = ?")
    .bind("yellow")
    .first("id");
  t.is(id, 4);
});
test("D1PreparedStatement: raw", async (t) => {
  const { db } = t.context;

  // Check with read statement
  type RawColourRow = [/* id */ number, /* name */ string, /* rgb*/ number];
  let results = await db.prepare("SELECT * FROM colours").raw<RawColourRow>();
  t.deepEqual(results, [
    [1, "red", 0xff0000],
    [2, "green", 0x00ff00],
    [3, "blue", 0x0000ff],
  ]);

  // Check with multiple statements (should only return first statement results)
  results = await db
    .prepare(
      "SELECT * FROM colours WHERE id = 1; SELECT * FROM colours WHERE id = 3;"
    )
    .raw<RawColourRow>();
  t.deepEqual(results, [[1, "red", 0xff0000]]);

  // Check with write statement (should actually execute, but return nothing)
  results = await db
    .prepare("INSERT INTO colours (id, name, rgb) VALUES (?, ?, ?)")
    .bind(4, "yellow", 0xffff00)
    .raw();
  t.deepEqual(results, []);
  const id = await db
    .prepare("SELECT id FROM colours WHERE name = ?")
    .bind("yellow")
    .first("id");
  t.is(id, 4);
});
