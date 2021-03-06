import { jest } from "@jest/globals";
import { handleRequest } from "./service-worker";

test("handles requests", async () => {
  const res = handleRequest(new Request("http://localhost/"));
  expect(await res.text()).toBe("body:http://localhost/");
});

test("includes custom globals", () => {
  expect(KEY).toBe("value");
});

test("uses Jest console", () => {
  console.log("hello!");
});

describe("uses Jest fake timers", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("modern", () => {
    jest.useFakeTimers("modern");
    const fn = jest.fn();
    setTimeout(fn, 1000);
    jest.runAllTimers();
    expect(fn).toHaveBeenCalled();
  });

  test("legacy", () => {
    jest.useFakeTimers("legacy");
    const fn = jest.fn();
    setTimeout(fn, 1000);
    jest.runAllTimers();
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
