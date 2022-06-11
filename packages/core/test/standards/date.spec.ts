import { setTimeout } from "timers/promises";
import { createDate } from "@miniflare/core";
import { RequestContext } from "@miniflare/shared";
import test from "ava";

test("Date: uses regular Date if actual time requested", (t) => {
  const DateImpl = createDate(true);
  t.is(DateImpl, Date);
});

test("Date: new Date() returns fixed time if no parameters provided", async (t) => {
  // Check inside request context
  const DateImpl = createDate();
  const ctx = new RequestContext();
  await ctx.runWith(async () => {
    const previous = new DateImpl().getTime();
    await setTimeout(100);
    t.is(new DateImpl().getTime(), previous);
    ctx.advanceCurrentTime();
    t.not(new DateImpl().getTime(), previous);
  });

  // Check outside request context (should return actual time here)
  const previous = new DateImpl().getTime();
  await setTimeout(100);
  t.not(new DateImpl().getTime(), previous);
});
test("Date: new Date() accepts regular constructor parameters", (t) => {
  const DateImpl = createDate();
  const date = new DateImpl(1000);
  t.is(date.getTime(), 1000);
});
test("Date: new Date() passes instanceof checks", (t) => {
  const DateImpl = createDate();
  t.not(DateImpl, Date);
  t.true(new DateImpl() instanceof Date);
  t.true(new Date() instanceof DateImpl);
});

test("Date: Date.now() returns fixed time", async (t) => {
  // Check inside request context
  const DateImpl = createDate();
  const ctx = new RequestContext();
  await ctx.runWith(async () => {
    const previous = DateImpl.now();
    await setTimeout(100);
    t.is(DateImpl.now(), previous);
    ctx.advanceCurrentTime();
    t.not(DateImpl.now(), previous);
  });

  // Check outside request context (should return actual time here)
  const previous = DateImpl.now();
  await setTimeout(100);
  t.not(DateImpl.now(), previous);
});
