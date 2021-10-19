import { ThrowingEventTarget } from "@miniflare/shared";
import test from "ava";

test("ThrowingEventTarget: propagates error from listener", (t) => {
  t.plan(3);

  const target = new ThrowingEventTarget<{ test: Event }>();
  // Should call listeners until error thrown, then stop
  target.addEventListener("test", () => t.pass());
  target.addEventListener("test", () => {
    t.pass();
    throw new Error("Test error");
  });
  target.addEventListener("test", () => t.fail());

  t.throws(() => target.dispatchEvent(new Event("test")), {
    instanceOf: Error,
    message: "Test error",
  });
});
