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

// Check basic functionality
let ranDescribe = false;
describe("describe", () => {
  beforeAll(() => append("c"));
  beforeEach(() => append("d"));

  test("describe test", async () => {
    ranDescribe = true;
    await append("e");
    expect(await get()).toBe("acbde");
  });
});
test("describe ran", async () => {
  expect(ranDescribe).toBe(true);
  // Check appends in describe undone
  await append("f");
  expect(await get()).toBe("abf");
});

// Check skipping
describe.skip("skipped describe 1", () => {
  test("skipped describe test", () => expect(true).toBe(false));
});

let ranSkippedIfDescribe = false;
describe.skipIf(true)("skipped describe 2", () => {
  test("skipped describe test", () => expect(true).toBe(false));
});
describe.skipIf(false)("skipped describe 3", () => {
  beforeAll(() => append("g"));
  beforeEach(() => append("h"));

  test("skipped describe test", async () => {
    ranSkippedIfDescribe = true;
    await append("i");
    expect(await get()).toBe("agbhi");
  });
});
test("skipped describe 3 ran", async () => {
  expect(ranSkippedIfDescribe).toBe(true);
  // Check appends in skipIf'ed describe undone
  await append("j");
  expect(await get()).toBe("abj");
});

let ranRunIfDescribe = false;
describe.runIf(true)("skipped describe 4", () => {
  beforeAll(() => append("k"));
  beforeEach(() => append("l"));

  test("skipped describe test", async () => {
    ranRunIfDescribe = true;
    await append("m");
    expect(await get()).toBe("akblm");
  });
});
describe.runIf(false)("skipped describe 5", () => {
  test("skipped describe test", () => expect(true).toBe(false));
});
test("skipped describe 4 ran", async () => {
  expect(ranRunIfDescribe).toBe(true);
  // Check appends in runIf'ed describe undone
  await append("n");
  expect(await get()).toBe("abn");
});

// Check todo
describe.todo("todo describe");

// Check each
let eachDescribeRuns = 0;
describe.each([{ n: 1 }, { n: 2 }, { n: 3 }])("each describe $n", ({ n }) => {
  beforeAll(() => append("o"));
  beforeEach(() => append("p"));

  test("each describe test", async () => {
    eachDescribeRuns++;
    await append(n.toString());
    expect(await get()).toBe("aobp" + n);
  });
});
test("each describe ran", async () => {
  expect(eachDescribeRuns).toBe(3);
  // Check appends in each describe undone
  await append("q");
  expect(await get()).toBe("abq");
});

// Check chaining
describe.concurrent.shuffle.skip("chained describe", () => {
  test("chained describe test", () => expect(true).toBe(false));
});
