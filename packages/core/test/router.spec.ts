// noinspection HttpUrlsUsage

import { URL } from "url";
import { Router, RouterError } from "@miniflare/core";
import test from "ava";

// See https://developers.cloudflare.com/workers/platform/routes#matching-behavior and
// https://developers.cloudflare.com/workers/platform/known-issues#route-specificity

test("Router: throws if route contains query string", (t) => {
  const router = new Router();
  t.throws(() => router.update(new Map([["a", ["example.com/?foo=*"]]])), {
    instanceOf: RouterError,
    code: "ERR_QUERY_STRING",
    message:
      'Route "example.com/?foo=*" for "a" contains a query string. This is not allowed.',
  });
});
test("Router: throws if route contains infix wildcards", (t) => {
  const router = new Router();
  t.throws(() => router.update(new Map([["a", ["example.com/*.jpg"]]])), {
    instanceOf: RouterError,
    code: "ERR_INFIX_WILDCARD",
    message:
      'Route "example.com/*.jpg" for "a" contains an infix wildcard. This is not allowed.',
  });
});
test("Router: routes may begin with http:// or https://", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["example.com/*"]]]));
  t.is(router.match(new URL("http://example.com/foo.jpg")), "a");
  t.is(router.match(new URL("https://example.com/foo.jpg")), "a");
  t.is(router.match(new URL("ftp://example.com/foo.jpg")), "a");

  router.update(
    new Map([
      ["a", ["http://example.com/*"]],
      ["b", ["https://example.com/*"]],
    ])
  );
  t.is(router.match(new URL("http://example.com/foo.jpg")), "a");
  t.is(router.match(new URL("https://example.com/foo.jpg")), "b");
  t.is(router.match(new URL("ftp://example.com/foo.jpg")), null);
});
test("Router: trailing slash automatically implied", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["example.com"]]]));
  t.is(router.match(new URL("http://example.com/")), "a");
  t.is(router.match(new URL("https://example.com/")), "a");
});
test("Router: route hostnames may begin with *", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["*example.com/"]]]));
  t.is(router.match(new URL("https://example.com/")), "a");
  t.is(router.match(new URL("https://www.example.com/")), "a");

  router.update(new Map([["a", ["*.example.com/"]]]));
  t.is(router.match(new URL("https://example.com/")), null);
  t.is(router.match(new URL("https://www.example.com/")), "a");
});
test("Router: correctly handles internationalised domain names beginning with *", (t) => {
  // https://github.com/cloudflare/miniflare/issues/186
  const router = new Router();
  router.update(new Map([["a", ["*glöd.se/*"]]]));
  t.is(router.match(new URL("https://glöd.se/*")), "a");
  t.is(router.match(new URL("https://www.glöd.se/*")), "a");

  router.update(new Map([["a", ["*.glöd.se/*"]]]));
  t.is(router.match(new URL("https://glöd.se/*")), null);
  t.is(router.match(new URL("https://www.glöd.se/*")), "a");
});
test("Router: route paths may end with *", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["https://example.com/path*"]]]));
  t.is(router.match(new URL("https://example.com/path")), "a");
  t.is(router.match(new URL("https://example.com/path2")), "a");
  t.is(router.match(new URL("https://example.com/path/readme.txt")), "a");
  t.is(router.match(new URL("https://example.com/notpath")), null);
});
test("Router: matches most specific route", (t) => {
  const router = new Router();
  router.update(
    new Map([
      ["a", ["www.example.com/*"]],
      ["b", ["*.example.com/*"]],
    ])
  );
  t.is(router.match(new URL("https://www.example.com/")), "a");

  router.update(
    new Map([
      ["a", ["example.com/*"]],
      ["b", ["example.com/hello/*"]],
    ])
  );
  t.is(router.match(new URL("https://example.com/hello/world")), "b");

  router.update(
    new Map([
      ["a", ["example.com/*"]],
      ["b", ["https://example.com/*"]],
    ])
  );
  t.is(router.match(new URL("https://example.com/hello")), "b");

  router.update(
    new Map([
      ["a", ["example.com/pa*"]],
      ["b", ["example.com/path*"]],
    ])
  );
  t.is(router.match(new URL("https://example.com/p")), null);
  t.is(router.match(new URL("https://example.com/pa")), "a");
  t.is(router.match(new URL("https://example.com/pat")), "a");
  t.is(router.match(new URL("https://example.com/path")), "b");
});
test("Router: matches query params", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["example.com/hello/*"]]]));
  t.is(router.match(new URL("https://example.com/hello/world?foo=bar")), "a");
});
test("Router: routes are case-sensitive", (t) => {
  const router = new Router();
  router.update(
    new Map([
      ["a", ["example.com/images/*"]],
      ["b", ["example.com/Images/*"]],
    ])
  );
  t.is(router.match(new URL("https://example.com/images/foo.jpg")), "a");
  t.is(router.match(new URL("https://example.com/Images/foo.jpg")), "b");
});
test("Router: escapes regexp control characters", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["example.com/*"]]]));
  t.is(router.match(new URL("https://example.com/")), "a");
  t.is(router.match(new URL("https://example2com/")), null);
});
test('Router: "correctly" handles routes with trailing /*', (t) => {
  const router = new Router();
  router.update(
    new Map([
      ["a", ["example.com/images/*"]],
      ["b", ["example.com/images*"]],
    ])
  );
  t.is(router.match(new URL("https://example.com/images")), "b");
  t.is(router.match(new URL("https://example.com/images123")), "b");
  t.is(router.match(new URL("https://example.com/images/hello")), "b"); // unexpected
});
test("Router: returns null if no routes match", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["example.com/*"]]]));
  t.is(router.match(new URL("https://miniflare.dev/")), null);
});
test("Router: matches everything route", (t) => {
  const router = new Router();
  router.update(new Map([["a", ["*/*"]]]));
  t.is(router.match(new URL("http://example.com/")), "a");
  t.is(router.match(new URL("https://example.com/")), "a");
  t.is(router.match(new URL("https://miniflare.dev/")), "a");
});
