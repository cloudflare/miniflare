import { QueueBroker } from "@miniflare/queues";
import { SchedulerError, SchedulerPlugin } from "@miniflare/scheduler";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
} from "@miniflare/shared";
import {
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
} from "@miniflare/shared-test";
import test from "ava";

const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueBroker = new QueueBroker();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker,
  queueEventDispatcher,
  sharedCache: unusable(),
};

test("SchedulerPlugin: parses options from argv", (t) => {
  let options = parsePluginArgv(SchedulerPlugin, [
    "--cron",
    "15 * * * *",
    "--cron",
    "30 * * * *",
  ]);
  t.deepEqual(options, { crons: ["15 * * * *", "30 * * * *"] });
  options = parsePluginArgv(SchedulerPlugin, [
    "-t",
    "15 * * * *",
    "-t",
    "30 * * * *",
  ]);
  t.deepEqual(options, { crons: ["15 * * * *", "30 * * * *"] });
});
test("SchedulerPlugin: parses options from wrangler config", (t) => {
  const options = parsePluginWranglerConfig(SchedulerPlugin, {
    triggers: { crons: ["15 * * * *", "30 * * * *"] },
  });
  t.deepEqual(options, { crons: ["15 * * * *", "30 * * * *"] });
});
test("SchedulerPlugin: logs options", (t) => {
  const logs = logPluginOptions(SchedulerPlugin, {
    crons: ["15 * * * *", "30 * * * *"],
  });
  t.deepEqual(logs, ["CRON Expressions: 15 * * * *, 30 * * * *"]);
});

test("SchedulerPlugin: setup: accepts valid CRON expressions", async (t) => {
  const plugin = new SchedulerPlugin(ctx, {
    crons: ["0 12 * * MON", "* * * * *"],
  });
  await plugin.setup();
  t.deepEqual(
    plugin.validatedCrons.map((cron) => cron.toString()),
    ["0 12 * * MON", "* * * * *"]
  );
});
test("SchedulerPlugin: setup: throws on invalid CRON expressions", async (t) => {
  let plugin = new SchedulerPlugin(ctx, {
    crons: ["* * * * BAD"],
  });
  await t.throwsAsync(plugin.setup(), {
    instanceOf: SchedulerError,
    code: "ERR_INVALID_CRON",
    message: /^Unable to parse CRON "\* \* \* \* BAD"/,
  });
  plugin = new SchedulerPlugin(ctx, { crons: ["*"] });
  await t.throwsAsync(plugin.setup(), {
    instanceOf: SchedulerError,
    code: "ERR_INVALID_CRON",
    message: /^Unable to parse CRON "\*"/,
  });
});
