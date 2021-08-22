import test from "ava";
import { formatSize } from "../src/helpers";

test("formatSize: formats sizes", (t) => {
  const kib = 1 << 10;
  const mib = 1 << 20;
  const gib = 1 << 30;
  t.is(formatSize(10), "10B");
  t.is(formatSize(0.5 * kib), "0.50KiB");
  t.is(formatSize(10 * kib), "10.00KiB");
  t.is(formatSize(0.5 * mib), "0.50MiB");
  t.is(formatSize(10 * mib), "10.00MiB");
  t.is(formatSize(gib), "1024.00MiB");
});
