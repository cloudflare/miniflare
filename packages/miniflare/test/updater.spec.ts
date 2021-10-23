import fs from "fs/promises";
import path from "path";
import { LogLevel } from "@miniflare/shared";
import { TestLog, useServer, useTmp } from "@miniflare/shared-test";
import test from "ava";
import { updateCheck } from "miniflare";

test("updateCheck: logs if updated version available", async (t) => {
  t.plan(5);
  const tmp = await useTmp(t);
  const lastCheckFile = path.join(tmp, "last-check");
  const now = 172800000; // 2 days since unix epoch (must be > 1 day)
  const registry = await useServer(t, (req, res) => {
    t.is(req.url, "/miniflare/latest");
    res.end('{"version": "1.1.0"}');
  });
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    lastCheckFile,
    now,
    registry: registry.http.toString(),
    log,
  });

  // Check update message logged
  t.is(log.logs.length, 1);
  t.is(log.logs[0][0], LogLevel.WARN);
  t.regex(
    log.logs[0][1],
    /^Miniflare 1\.1\.0 is available, but you're using 1\.0\.0/
  );
  // Check last update check file written
  const lastCheck = await fs.readFile(lastCheckFile, "utf8");
  t.is(lastCheck, now.toString());
});
test("updateCheck: logs additional warning on semver major change", async (t) => {
  const tmp = await useTmp(t);
  const lastCheckFile = path.join(tmp, "last-check");
  const now = 172800000; // 2 days since unix epoch (must be > 1 day)
  const registry = await useServer(t, (req, res) => {
    res.end('{"version": "2.0.0"}');
  });
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    lastCheckFile,
    now,
    registry: registry.http.toString(),
    log,
  });

  // Check update messages logged
  t.is(log.logs.length, 2);
  t.is(log.logs[0][0], LogLevel.WARN);
  t.regex(
    log.logs[0][1],
    /^Miniflare 2\.0\.0 is available, but you're using 1\.0\.0/
  );
  t.is(log.logs[1][0], LogLevel.WARN);
  t.regex(log.logs[1][1], /^2\.0\.0 includes breaking changes/);
});
test("updateCheck: doesn't log if no updated version available", async (t) => {
  const tmp = await useTmp(t);
  const lastCheckFile = path.join(tmp, "last-check");
  const now = 172800000; // 2 days since unix epoch (must be > 1 day)
  const registry = await useServer(t, (req, res) => {
    res.end('{"version": "1.0.0"}');
  });
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    lastCheckFile,
    now,
    registry: registry.http.toString(),
    log,
  });

  // Check no update message logged
  t.is(log.logs.length, 0);
  // Check last update check file still written
  const lastCheck = await fs.readFile(lastCheckFile, "utf8");
  t.is(lastCheck, now.toString());
});
test("updateCheck: skips if already checked in past day", async (t) => {
  const tmp = await useTmp(t);
  const lastCheckFile = path.join(tmp, "last-check");

  // Write last check time to file
  const lastCheckTime = 129600000; // 1.5 days since unix epoch
  await fs.writeFile(lastCheckFile, lastCheckTime.toString(), "utf8");

  const now = 172800000; // 2 days since unix epoch
  const registry = await useServer(t, () => t.fail());
  const log = new TestLog();
  await updateCheck({
    pkg: { name: "miniflare", version: "1.0.0" },
    lastCheckFile,
    now,
    registry: registry.http.toString(),
    log,
  });
  // Check no update message logged
  t.is(log.logs.length, 0);
  // Check last update check file not updated
  const lastCheck = await fs.readFile(lastCheckFile, "utf8");
  t.is(lastCheck, lastCheckTime.toString());
});
