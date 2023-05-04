import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_WAIT_MS,
  QueueBroker,
  QueuesPlugin,
  WorkerQueue,
} from "@miniflare/queues";
import {
  Compatibility,
  NoOpLog,
  PluginContext,
  QueueEventDispatcher,
  kGetConsumer,
} from "@miniflare/shared";
import {
  MemoryStorageFactory,
  logPluginOptions,
  parsePluginArgv,
  parsePluginWranglerConfig,
  unusable,
} from "@miniflare/shared-test";
import test from "ava";

const factory = new MemoryStorageFactory();
const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const queueEventDispatcher: QueueEventDispatcher = async (_batch) => {};
const ctx: PluginContext = {
  log,
  compat,
  rootPath,
  queueBroker: unusable(),
  queueEventDispatcher,
  globalAsyncIO: true,
  sharedCache: unusable(),
};

test("QueuesPlugin: parses options from argv", async (t) => {
  const options = parsePluginArgv(QueuesPlugin, [
    "--queue",
    "QUEUE1=queue1",
    "--queue",
    "QUEUE2=queue2",
    "--queue-consumer",
    "queue1",
  ]);
  t.deepEqual(options, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueConsumers: ["queue1"],
  });

  // setup the plugin and verify default values
  const queueBroker = new QueueBroker();
  const plugin = new QueuesPlugin({ ...ctx, queueBroker }, options);
  await plugin.setup(factory);
  await plugin.beforeReload();

  const queue1 = queueBroker.getOrCreateQueue("queue1");
  t.deepEqual(queue1[kGetConsumer]()?.maxBatchSize, DEFAULT_BATCH_SIZE);
  t.deepEqual(queue1[kGetConsumer]()?.maxWaitMs, DEFAULT_WAIT_MS);
});

test("QueuesPlugin: parses options from wrangler config", async (t) => {
  const options = parsePluginWranglerConfig(QueuesPlugin, {
    queues: {
      producers: [
        { binding: "QUEUE1", queue: "queue1" },
        { binding: "QUEUE2", queue: "queue2" },
      ],
      consumers: [
        { queue: "queue1" },
        {
          queue: "queue2",
          batch_size: 10,
          batch_timeout: 7,
          message_retries: 5,
          dead_letter_queue: "DLQ",
        },
      ],
    },
  });
  t.deepEqual(options, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueConsumers: [
      { queueName: "queue1" },
      {
        queueName: "queue2",
        maxBatchSize: 10,
        maxWaitMs: 7000,
        maxRetries: 5,
        deadLetterQueue: "DLQ",
      },
    ],
  });

  // verify default vs custom values on optional settings
  const queueBroker = new QueueBroker();
  const plugin = new QueuesPlugin({ ...ctx, queueBroker }, options);
  await plugin.setup(factory);
  await plugin.beforeReload();

  // queue1 uses defaults
  const queue1 = queueBroker.getOrCreateQueue("queue1");
  t.deepEqual(queue1[kGetConsumer]()?.maxBatchSize, DEFAULT_BATCH_SIZE);
  t.deepEqual(queue1[kGetConsumer]()?.maxWaitMs, DEFAULT_WAIT_MS);

  // queue2 has custom settings
  const queue2 = queueBroker.getOrCreateQueue("queue2");
  t.deepEqual(queue2[kGetConsumer]()?.maxBatchSize, 10);
  t.deepEqual(queue2[kGetConsumer]()?.maxWaitMs, 7000);
});

test("QueuesPlugin: logs options", (t) => {
  const logs = logPluginOptions(QueuesPlugin, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
    queueConsumers: [
      { queueName: "queue1", maxBatchSize: 10, maxWaitMs: 7000 },
      { queueName: "queue2", maxBatchSize: 10, maxWaitMs: 7000 },
    ],
  });
  t.deepEqual(logs, [
    "Queue Bindings: QUEUE1, QUEUE2",
    "Queue Consumers: queue1, queue2",
  ]);
});

test("QueuesPlugin: setup: includes queues in bindings", async (t) => {
  const queueBroker = new QueueBroker();
  const pluginCtx: PluginContext = { ...ctx, queueBroker };
  const plugin = new QueuesPlugin(pluginCtx, {
    queueBindings: [
      { name: "QUEUE1", queueName: "queue1" },
      { name: "QUEUE2", queueName: "queue2" },
    ],
  });

  const result = await plugin.setup(factory);
  t.true(result.bindings?.QUEUE1 instanceof WorkerQueue);
  t.true(result.bindings?.QUEUE2 instanceof WorkerQueue);
});

test("QueuesPlugin: setup: requires module exports if consuming", async (t) => {
  const queueBroker = new QueueBroker();
  const pluginCtx: PluginContext = { ...ctx, queueBroker };
  let plugin = new QueuesPlugin(pluginCtx, {
    queueBindings: [{ name: "QUEUE", queueName: "queue" }],
  });
  let result = await plugin.setup(factory);
  t.false(result.requiresModuleExports);
  plugin = new QueuesPlugin(pluginCtx, {
    queueConsumers: ["queue"],
  });
  result = await plugin.setup(factory);
  t.true(result.requiresModuleExports);
});
