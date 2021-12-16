import { RequestContext, getRequestContext } from "@miniflare/shared";
import test, { ThrowsExpectation } from "ava";

test("RequestContext: incrementSubrequests: throws if subrequest count exceeds maximum", (t) => {
  const ctx = new RequestContext();

  ctx.incrementSubrequests(25);
  t.is(ctx.subrequests, 25);

  // Check async context working
  ctx.runWith(() => getRequestContext()?.incrementSubrequests(24));
  t.is(ctx.subrequests, 49);

  // Check count defaults to 1
  ctx.incrementSubrequests();
  t.is(ctx.subrequests, 50);

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message:
      "Too many subrequests. Workers can make up to 50 subrequests per request." +
      "\nA subrequest is a call to fetch(), a redirect, or a call to any Cache API method.",
  };
  t.throws(() => ctx.incrementSubrequests(), expectations);

  // Check continues to throw
  t.throws(() => ctx.incrementSubrequests(), expectations);
});
