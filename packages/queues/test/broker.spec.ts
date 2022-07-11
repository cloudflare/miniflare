import { QueueBroker } from "@miniflare/queues";
import { Subscription, kSetSubscription } from "@miniflare/shared";
import test from "ava";

test("QueueBroker: flushes partial batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Subscription = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: (_queue, _messages) => {},
  };
  q[kSetSubscription](sub);

  let prom = new Promise<void>((resolve) => {
    sub.dispatcher = (queueName: string, messages: any[]) => {
      t.deepEqual(messages, ["message1"]);
      resolve();
    };

    q.send("message1");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (queueName: string, messages: any[]) => {
      t.deepEqual(messages, ["message2", "message3"]);
      resolve();
    };

    q.send("message2");
    q.send("message3");
  });
  await prom;

  prom = new Promise<void>((resolve) => {
    sub.dispatcher = (queueName: string, messages: any[]) => {
      t.deepEqual(messages, ["message4", "message5", "message6"]);
      resolve();
    };

    q.send("message4");
    q.send("message5");
    q.send("message6");
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
    dispatcher: (_queue, _messages) => {},
  };
  q[kSetSubscription](sub);
  let prom = new Promise<void>((resolve) => {
    sub.dispatcher = (queueName: string, messages: any[]) => {
      t.deepEqual(messages, [
        "message1",
        "message2",
        "message3",
        "message4",
        "message5",
      ]);
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
    sub.dispatcher = (queueName: string, messages: any[]) => {
      t.deepEqual(messages, [
        "message6",
        "message7",
        "message8",
        "message9",
        "message10",
        "message11",
        "message12",
      ]);
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
});
