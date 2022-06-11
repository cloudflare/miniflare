import {
  EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  RequestContext,
  getRequestContext,
} from "@miniflare/shared";
import test, { ThrowsExpectation } from "ava";

test("RequestContext: depths default to 1", (t) => {
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  t.is(ctx.requestDepth, 1);
  t.is(ctx.pipelineDepth, 1);
});

test("RequestContext: throws if depth limit exceeded", (t) => {
  new RequestContext({
    requestDepth: 16,
    pipelineDepth: 1,
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  t.throws(
    () =>
      new RequestContext({
        requestDepth: 17,
        pipelineDepth: 1,
        externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
      }),
    {
      instanceOf: Error,
      message:
        /^Subrequest depth limit exceeded.+\nWorkers and objects can recurse up to 16 times\./,
    }
  );

  new RequestContext({
    requestDepth: 1,
    pipelineDepth: 32,
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });
  t.throws(
    () =>
      new RequestContext({
        requestDepth: 1,
        pipelineDepth: 33,
        externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
      }),
    {
      instanceOf: Error,
      message:
        /^Subrequest depth limit exceeded.+\nService bindings can recurse up to 32 times\./,
    }
  );
});

test("RequestContext: incrementExternalSubrequests: throws if subrequest count exceeds maximum", (t) => {
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  ctx.incrementExternalSubrequests(25);
  t.is(ctx.externalSubrequests, 25);

  // Check async context working
  ctx.runWith(() => getRequestContext()?.incrementExternalSubrequests(24));
  t.is(ctx.externalSubrequests, 49);

  // Check count defaults to 1
  ctx.incrementExternalSubrequests();
  t.is(ctx.externalSubrequests, 50);

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message:
      "Too many subrequests. Workers can make up to 50 subrequests per request." +
      "\nA subrequest is a call to fetch(), a redirect, or a call to any Cache API method.",
  };
  t.throws(() => ctx.incrementExternalSubrequests(), expectations);

  // Check continues to throw
  t.throws(() => ctx.incrementExternalSubrequests(), expectations);
});

test("RequestContext: incrementInternalSubrequests: throws if subrequest count exceeds maximum", (t) => {
  const ctx = new RequestContext({
    externalSubrequestLimit: EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
  });

  ctx.incrementInternalSubrequests(999);
  t.is(ctx.internalSubrequests, 999);

  // Check count defaults to 1
  ctx.incrementInternalSubrequests();
  t.is(ctx.internalSubrequests, 1000);

  const expectations: ThrowsExpectation = {
    instanceOf: Error,
    message:
      "Too many API requests by single worker invocation. " +
      "Workers can make up to 1000 KV and Durable Object requests per invocation.",
  };
  t.throws(() => ctx.incrementInternalSubrequests(), expectations);

  // Check continues to throw
  t.throws(() => ctx.incrementInternalSubrequests(), expectations);
});
