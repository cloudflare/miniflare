import { afterEach, expect, test, vi } from "vitest";
import { handleRequest } from "./service-worker";
const describe = setupMiniflareIsolatedStorage();

test("handles requests", async () => {
  const res = handleRequest(new Request("http://localhost/"));
  expect(await res.text()).toBe("body:http://localhost/");
});

test("includes custom globals", () => {
  expect(KEY).toBe("value");
});

test("uses Vitest console", () => {
  console.log("hello!");
});

describe("uses Vitest fake timers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("timers", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setTimeout(fn, 1000);
    vi.runAllTimers();
    expect(fn).toHaveBeenCalled();
  });
});

test("can generate secure random numbers", () => {
  crypto.getRandomValues(new Uint8Array(8));
});

test("Object instanceof checks succeed", () => {
  expect(new Uint8Array() instanceof Object).toBe(true);
  expect({} instanceof Object).toBe(true);
  expect({}.constructor === Object).toBe(true);
  expect(new Object({ a: 1 })).toEqual({ a: 1 });
  expect(Object.getPrototypeOf({}) === Object.prototype);
});

test("allows dynamic code generation", () => {
  expect(eval("1 + 1")).toBe(2);
});

test("crypto supports md5 hashing", async () => {
  // Check Miniflare's WebCrypto API is injected, by checking a non-spec,
  // Worker-only digest algorithm
  const data = new TextEncoder().encode("test");
  const digest = await crypto.subtle.digest("md5", data);
  const hexDigest = Buffer.from(digest).toString("hex");
  expect(hexDigest).toBe("098f6bcd4621d373cade4e832627b4f6");
});
