import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_WAIT_MS,
  Queue,
  QueueBroker,
  QueuesPlugin,
} from "@miniflare/queues";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  kGetSubscription,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
} from "@miniflare/shared-test";
import test from "ava";

const factory = new MemoryStorageFactory();
const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueEventDispatcher: QueueEventDispatcher = (_batch) => {};

test("QueuesPlugin: parses options from argv", async (t) => {
  const options = parsePluginArgv(QueuesPlugin, [
    "--queue",
    "QUEUE1=queue1",
    "--queue",
    "QUEUE2=queue2",
    "--queue-subscription",
    "queue1",
  ]);
  t.deepEqual(options, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueSubscriptions: ["queue1"],
  });

  // setup the plugin and verify default values
  const queueBroker = new QueueBroker();
  const ctx: PluginContext = {
    log,
    compat,
    rootPath,
    globalAsyncIO: true,
    queueBroker,
    queueEventDispatcher,
  };
  const plugin = new QueuesPlugin(ctx, options);
  await plugin.setup(factory);

  const queue1 = queueBroker.getOrCreateQueue("queue1");
  t.deepEqual(queue1[kGetSubscription]()?.maxBatchSize, DEFAULT_BATCH_SIZE);
  t.deepEqual(queue1[kGetSubscription]()?.maxWaitMs, DEFAULT_WAIT_MS);
});

test("QueuesPlugin: parses options from wrangler config", async (t) => {
  const options = parsePluginWranglerConfig(QueuesPlugin, {
    queues: {
      bindings: [
        { name: "QUEUE1", queue_name: "queue1" },
        { name: "QUEUE2", queue_name: "queue2" },
      ],
      subscriptions: [
        { queue_name: "queue1" },
        { queue_name: "queue2", max_batch_size: 10, max_wait_secs: 7 },
      ],
    },
  });
  t.deepEqual(options, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueSubscriptions: [
      { queueName: "queue1" },
      { queueName: "queue2", maxBatchSize: 10, maxWaitMs: 7000 },
    ],
  });

  // verify default vs custom values on optional settings
  const queueBroker = new QueueBroker();
  const ctx: PluginContext = {
    log,
    compat,
    rootPath,
    globalAsyncIO: true,
    queueBroker,
    queueEventDispatcher,
  };
  const plugin = new QueuesPlugin(ctx, options);
  await plugin.setup(factory);

  // queue1 uses defaults
  const queue1 = queueBroker.getOrCreateQueue("queue1");
  t.deepEqual(queue1[kGetSubscription]()?.maxBatchSize, DEFAULT_BATCH_SIZE);
  t.deepEqual(queue1[kGetSubscription]()?.maxWaitMs, DEFAULT_WAIT_MS);

  // queue2 has custom settings
  const queue2 = queueBroker.getOrCreateQueue("queue2");
  t.deepEqual(queue2[kGetSubscription]()?.maxBatchSize, 10);
  t.deepEqual(queue2[kGetSubscription]()?.maxWaitMs, 7000);
});

test("QueuesPlugin: logs options", (t) => {
  const logs = logPluginOptions(QueuesPlugin, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueSubscriptions: [
      { queueName: "queue1", maxBatchSize: 10, maxWaitMs: 7000 },
      { queueName: "queue2", maxBatchSize: 10, maxWaitMs: 7000 },
    ],
  });
  t.deepEqual(logs, [
    "Queue Bindings: QUEUE1, QUEUE2",
    "Queue Subscriptions: queue1, queue2",
  ]);
});

test("QueuesPlugin: setup: includes queues in bindings", async (t) => {
  const queueBroker = new QueueBroker();
  const ctx: PluginContext = {
    log,
    compat,
    rootPath,
    globalAsyncIO: true,
    queueBroker,
    queueEventDispatcher,
  };

  const plugin = new QueuesPlugin(ctx, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
  });

  const result = await plugin.setup(factory);
  t.true(result.bindings?.QUEUE1 instanceof Queue);
  t.true(result.bindings?.QUEUE2 instanceof Queue);
});
