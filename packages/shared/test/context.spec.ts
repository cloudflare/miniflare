import { RequestContext, getRequestContext } from "@miniflare/shared";
import test, { ThrowsExpectation } from "ava";

test("RequestContext: depths default to 1", (t) => {
  const ctx = new RequestContext();
  t.is(ctx.requestDepth, 1);
  t.is(ctx.pipelineDepth, 1);
});

test("RequestContext: subrequest limit defaults to 50", (t) => {
  let ctx = new RequestContext();
  t.is(ctx.subrequestLimit, 50);
  ctx = new RequestContext({ subrequestLimit: true });
  t.is(ctx.subrequestLimit, 50);
  ctx = new RequestContext({ subrequestLimit: false });
  t.is(ctx.subrequestLimit, false);
  ctx = new RequestContext({ subrequestLimit: 25 });
  t.is(ctx.subrequestLimit, 25);
});

test("RequestContext: throws if depth limit exceeded", (t) => {
  new RequestContext({ requestDepth: 16, pipelineDepth: 1 });
  t.throws(() => new RequestContext({ requestDepth: 17, pipelineDepth: 1 }), {
    instanceOf: Error,
    message:
      /^Subrequest depth limit exceeded.+\nWorkers and objects can recurse up to 16 times\./,
  });

  new RequestContext({ requestDepth: 1, pipelineDepth: 32 });
  t.throws(() => new RequestContext({ requestDepth: 1, pipelineDepth: 33 }), {
    instanceOf: Error,
    message:
      /^Subrequest depth limit exceeded.+\nService bindings can recurse up to 32 times\./,
  });
});

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
