import { QueueBroker, kSetFlushCallback } from "@miniflare/queues";
import {
  Consumer,
  LogLevel,
  MessageBatch,
  kSetConsumer,
} from "@miniflare/shared";
import { TestLog } from "@miniflare/shared-test";
import test from "ava";

test("QueueBroker: flushes partial batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 2,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(batch.queue, "myQueue");

    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [{ id: "myQueue-0", body: "message1" }]
    );
  };
  q.send("message1");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-1", body: "message2" },
        { id: "myQueue-2", body: "message3" },
      ]
    );
  };
  q.send("message2");
  q.send("message3");

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-3", body: "message4" },
        { id: "myQueue-4", body: "message5" },
        { id: "myQueue-5", body: "message6" },
      ]
    );
  };
  q.send("message4");
  q.send("message5");
  q.send("message6");
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-6", body: "message7" },
        { id: "myQueue-7", body: "message8" },
        { id: "myQueue-8", body: "message9" },
      ]
    );
  };

  q.sendBatch([
    { body: "message7" },
    { body: "message8" },
    { body: "message9" },
  ]);
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
});

test("QueueBroker: flushes full batches of maxBatchSize", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 2,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);
  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => x.body),
      ["message1", "message2", "message3", "message4", "message5"]
    );
  };

  q.send("message1");
  q.send("message2");
  q.send("message3");
  q.send("message4");
  q.send("message5");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  let expectedBatches = [
    ["message6", "message7", "message8", "message9", "message10"],
    ["message11", "message12"],
  ];
  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => x.body),
      expectedBatches[0]
    );
    expectedBatches.shift();
  };

  q.send("message6");
  q.send("message7");
  q.send("message8");
  q.send("message9");
  q.send("message10");
  q.send("message11");
  q.send("message12");
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  expectedBatches = [
    ["message13", "message14", "message15", "message16", "message17"],
    ["message18", "message19", "message20", "message21", "message22"],
    ["message23"],
  ];

  q.sendBatch([
    { body: "message13" },
    { body: "message14" },
    { body: "message15" },
    { body: "message16" },
    { body: "message17" },
    { body: "message18" },
    { body: "message19" },
    { body: "message20" },
    { body: "message21" },
    { body: "message22" },
    { body: "message23" },
  ]);
  for (let i = 0; i < 3; ++i) {
    prom = new Promise<void>((resolve) => {
      q[kSetFlushCallback](() => resolve());
    });
    await prom;
  }
});

test("QueueBroker: supports message retry()", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 2,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    if (retries == 0) {
      batch.messages[0].retry();
      retries++;

      // Send another message from within the dispatcher
      // to ensure it doesn't get dropped
      q.send("message2");
      return;
    }

    // The second time around both messages should be present
    t.deepEqual(batch.messages.length, 2);
    t.deepEqual(batch.messages[0].body, "message2");
    t.deepEqual(batch.messages[1].body, "message1");
  };

  // Expect the queue to flush() twice (one retry)
  q.send("message1");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);
});

test("QueueBroker: automatic retryAll() on consumer error", async (t) => {
  const log = new TestLog();
  log.error = (message) =>
    log.logWithLevel(LogLevel.ERROR, message?.stack ?? "");

  const broker = new QueueBroker(log);
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 2,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    if (retries == 0) {
      // Send another message from within the dispatcher
      // to ensure it doesn't get dropped
      q.send("message3");
      retries++;

      throw new Error("fake consumer error");
    }

    // The second time around 3 messages should be present
    t.deepEqual(batch.messages.length, 3);
    t.deepEqual(batch.messages[0].body, "message3");
    t.deepEqual(batch.messages[1].body, "message1");
    t.deepEqual(batch.messages[2].body, "message2");
  };

  // Expect the queue to flush() twice (one retry)
  q.send("message1");
  q.send("message2");

  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);

  // Check consumer error logged followed by message retries
  t.is(log.logs[0][0], LogLevel.ERROR);
  t.regex(log.logs[0][1], /^myQueue Consumer: Error: fake consumer error/);
  t.deepEqual(log.logsAtLevel(LogLevel.DEBUG), [
    'Retrying message "myQueue-0"...',
    'Retrying message "myQueue-1"...',
  ]);

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);
});

test("QueueBroker: drops messages after max retry()", async (t) => {
  const log = new TestLog();
  log.error = (message) =>
    log.logWithLevel(LogLevel.ERROR, message?.stack ?? "");

  const broker = new QueueBroker(log);
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 4,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    batch.messages[0].retry();
    retries++;
  };

  // Expect the queue to flush() the maximum number of times
  q.send("message1");

  for (let i = 0; i < 5; i++) {
    const prom = new Promise<void>((resolve) => {
      q[kSetFlushCallback](() => resolve());
    });
    await prom;
    t.deepEqual(retries, i + 1);
  }

  // Check last log message is warning that message dropped
  t.deepEqual(log.logs[log.logs.length - 1], [
    LogLevel.WARN,
    'Dropped message "myQueue-0" after 5 failed attempts!',
  ]);

  // To check that "message1" is dropped:
  // send another message "message2" and ensure it is the only one in the new batch
  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(batch.messages.length, 1);
    t.deepEqual(batch.messages[0].body, "message2");
  };
  q.send("message2");
  const prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
});

test("QueueBroker: dead letter queue support", async (t) => {
  const log = new TestLog();
  log.error = (message) =>
    log.logWithLevel(LogLevel.ERROR, message?.stack ?? "");

  const broker = new QueueBroker(log);

  // Setup the original queue
  const q = broker.getOrCreateQueue("myQueue");
  const originalConsumer: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 1,
    deadLetterQueue: "myDLQ",
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](originalConsumer);

  const dlq = broker.getOrCreateQueue("myDLQ");
  const dlqConsumer: Consumer = {
    queueName: "myDLQ",
    maxBatchSize: 5,
    maxWaitMs: 1,
    maxRetries: 0,
    dispatcher: async (_batch) => {},
  };
  dlq[kSetConsumer](dlqConsumer);

  // Set up the consumer for the original queue
  let originalInvocations = 0;
  originalConsumer.dispatcher = async (batch: MessageBatch) => {
    batch.messages[0].retry();
    originalInvocations++;
  };

  // Set up the consumer for the dead letter queue
  let dlqInvocations = 0;
  dlqConsumer.dispatcher = async (_batch: MessageBatch) => {
    dlqInvocations++;
  };

  const originalQProm = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  q.send("message1");
  await originalQProm;

  const dlqProm = new Promise<void>((resolve) => {
    dlq[kSetFlushCallback](() => resolve());
  });
  await dlqProm;

  t.deepEqual(originalInvocations, 2);
  t.deepEqual(dlqInvocations, 1);

  // Check last log message is warning that message dropped
  t.deepEqual(log.logs[log.logs.length - 1], [
    LogLevel.WARN,
    'Moving message "myQueue-0" to dead letter queue "myDLQ"...',
  ]);
});
