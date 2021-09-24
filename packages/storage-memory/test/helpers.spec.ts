import { intersects } from "@miniflare/storage-memory";
import test from "ava";

test("intersects: returns true if sets intersect", (t) => {
  t.true(intersects(new Set(["a", "b", "c"]), new Set(["c", "d", "e"])));
});

test("intersects: returns false is sets disjoint", (t) => {
  t.false(intersects(new Set(["a", "b", "c"]), new Set(["d", "e"])));
});

test("intersects: returns false is either set empty", (t) => {
  t.false(intersects(new Set(), new Set(["a"])));
  t.false(intersects(new Set(["a"]), new Set()));
});
