import { beforeAll, beforeEach, expect, test } from "vitest";
// Check Miniflare's "describe" function behaves like Vitest's default `describe`
const describe = setupMiniflareIsolatedStorage();

async function get() {
  return await TEST_NAMESPACE.get("thing");
}

async function append(str) {
  const value = (await get()) ?? "";
  await TEST_NAMESPACE.put("thing", value + str);
}

beforeAll(() => append("a"));
beforeEach(() => append("b"));

// Check describe.only

// These tests shouldn't be run
test("other test", () => expect(true).toBe(false));
describe("other describe", () => {
  beforeAll(() => append("c"));
  beforeEach(() => append("d"));

  test("other describe test", () => expect(true).toBe(false));
});

// These tests should be run
let ranOnlyDescribe = false;
describe.only("describe", () => {
  beforeAll(() => append("e"));
  beforeEach(() => append("f"));

  test("describe test", async () => {
    ranOnlyDescribe = true;
    await append("g");
    expect(await get()).toBe("aebfg");
  });
});
test.only("describe ran", async () => {
  expect(ranOnlyDescribe).toBe(true);
  // Check appends in describe undone
  await append("h");
  expect(await get()).toBe("abh");
});
