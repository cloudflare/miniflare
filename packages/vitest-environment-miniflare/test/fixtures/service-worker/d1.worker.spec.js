import { beforeAll, beforeEach, expect, test } from "vitest";
const describe = setupMiniflareIsolatedStorage();

// This would normally be provided by the Wrangler shim
// (in local mode, it does nothing but rename the binding)
const DB_1 = __D1_BETA__DB_1;

async function get() {
  const result = await DB_1.prepare(`SELECT value FROM entries LIMIT 1;`).all();
  return result.results[0]?.value ?? "";
}

async function append(str) {
  const value = await get();
  await DB_1.prepare(`UPDATE entries SET value = ?`)
    .bind(value + str)
    .run();
}

beforeAll(async () => {
  await DB_1.exec(`CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)`);
  await DB_1.exec(`INSERT INTO entries (value) VALUES ('a')`);
});
beforeEach(() => append("b"));

test("D1 test 1", async () => {
  await append("c");
  expect(await get()).toBe("abc");
});
test("D1 test 2", async () => {
  await append("d");
  expect(await get()).toBe("abd");
});

describe("more D1 tests", () => {
  beforeAll(() => append("e"));
  beforeEach(() => append("f"));

  test("D1 test 3", async () => {
    await append("g");
    expect(await get()).toBe("aebfg");
  });
  test("D1 test 4", async () => {
    await append("h");
    expect(await get()).toBe("aebfh");
  });

  describe("even more D1 tests", () => {
    beforeAll(() => append("i"));
    beforeEach(() => append("j"));

    test("D1 test 5", async () => {
      await append("k");
      expect(await get()).toBe("aeibfjk");
    });
    test("D1 test 6", async () => {
      await append("l");
      expect(await get()).toBe("aeibfjl");
    });
  });
});

test("D1 test 7", async () => {
  await append("m");
  expect(await get()).toBe("abm");
});
test("D1 test 8", async () => {
  await append("n");
  expect(await get()).toBe("abn");
});
