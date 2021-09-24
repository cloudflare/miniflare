import { NoOpCache } from "@miniflare/cache";
import test from "ava";
import { testResponse } from "./helpers";

test("NoOpCache: doesn't cache", async (t) => {
  const req = "http://localhost:8787/test";
  const cache = new NoOpCache();
  t.is(await cache.put(req, testResponse()), undefined);
  t.is(await cache.match(req), undefined);
  t.is(await cache.put(req, testResponse()), undefined);
  t.false(await cache.delete(req));
});
