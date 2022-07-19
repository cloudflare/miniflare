import { QueueBroker } from "@miniflare/queues";
import {
  MessageBatch,
  Subscription,
  kSetSubscription,
} from "@miniflare/shared";
import test from "ava";

test("QueueBroker: flushes partial batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Subscription = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: (_batch) => {},
  };
  q[kSetSubscription](sub);

  let prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
      t.deepEqual(batch.queue, "myQueue");

      t.deepEqual(
        batch.messages.map((x) => {
          return { id: x.id, body: x.body };
        }),
        [{ id: "myQueue-0", body: "message1" }]
      );
      resolve();
    };

    q.send("message1");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
      t.deepEqual(
        batch.messages.map((x) => {
          return { id: x.id, body: x.body };
        }),
        [
          { id: "myQueue-1", body: "message2" },
          { id: "myQueue-2", body: "message3" },
        ]
      );
      resolve();
    };

    q.send("message2");
    q.send("message3");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
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
      resolve();
    };

    q.send("message4");
    q.send("message5");
    q.send("message6");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
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
      resolve();
    };

    q.sendBatch([
      { body: "message7" },
      { body: "message8" },
      { body: "message9" },
    ]);
  });
  await prom;
});

test("QueueBroker: flushes full batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Subscription = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: (_batch) => {},
  };
  q[kSetSubscription](sub);
  let prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
      t.deepEqual(
        batch.messages.map((x) => x.body),
        ["message1", "message2", "message3", "message4", "message5"]
      );
      resolve();
    };

    q.send("message1");
    q.send("message2");
    q.send("message3");
    q.send("message4");
    q.send("message5");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
      t.deepEqual(
        batch.messages.map((x) => x.body),
        [
          "message6",
          "message7",
          "message8",
          "message9",
          "message10",
          "message11",
          "message12",
        ]
      );
      resolve();
    };

    q.send("message6");
    q.send("message7");
    q.send("message8");
    q.send("message9");
    q.send("message10");
    q.send("message11");
    q.send("message12");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (batch: MessageBatch) => {
      t.deepEqual(
        batch.messages.map((x) => x.body),
        [
          "message13",
          "message14",
          "message15",
          "message16",
          "message17",
          "message18",
          "message19",
        ]
      );
      resolve();
    };

    q.sendBatch([
      { body: "message13" },
      { body: "message14" },
      { body: "message15" },
      { body: "message16" },
      { body: "message17" },
      { body: "message18" },
      { body: "message19" },
    ]);
  });
  await prom;
});
