import {
  Consumer,
  Log,
  MessageBatch as MessageBatchInterface,
  Message as MessageInterface,
  MessageSendOptions,
  MessageSendRequest,
  MiniflareError,
  QueueBroker as QueueBrokerInterface,
  Queue as QueueInterface,
  kGetConsumer,
  kSetConsumer,
  prefixError,
  structuredCloneImpl,
} from "@miniflare/shared";

export type QueueErrorCode = "ERR_CONSUMER_ALREADY_SET";

export class QueueError extends MiniflareError<QueueErrorCode> {}

const kGetPendingRetry = Symbol("kGetPendingRetry");
const kPrepareForRetry = Symbol("kPrepareForRetry");
const kGetFailedAttempts = Symbol("kGetFailedAttempts");

export class Message<Body = unknown> implements MessageInterface<Body> {
  readonly body: Body;
  readonly #log?: Log;

  // Internal state for tracking retries
  // Eventually, this will need to be moved or modified to support
  // multiple consumers on a single queue.
  #pendingRetry: boolean;
  #failedAttempts: number;

  constructor(
    readonly id: string,
    readonly timestamp: Date,
    body: Body,
    log?: Log
  ) {
    this.body = (globalThis.structuredClone ?? structuredCloneImpl)(body);
    this.#log = log;

    this.#pendingRetry = false;
    this.#failedAttempts = 0;
  }

  retry(): void {
    this.#pendingRetry = true;
  }

  [kPrepareForRetry]() {
    this.#pendingRetry = false;
    this.#failedAttempts++;
  }

  [kGetPendingRetry](): boolean {
    return this.#pendingRetry;
  }

  [kGetFailedAttempts](): number {
    return this.#failedAttempts;
  }
}

export class MessageBatch<Body = unknown>
  implements MessageBatchInterface<Body>
{
  readonly queue: string;
  readonly messages: Message<Body>[];

  constructor(queue: string, messages: Message<Body>[]) {
    this.queue = queue;
    this.messages = messages;
  }

  retryAll(): void {
    for (const msg of this.messages) {
      msg.retry();
    }
  }
}

enum FlushType {
  NONE,
  DELAYED,
  IMMEDIATE,
}

export const kSetFlushCallback = Symbol("kSetFlushCallback");

export class WorkerQueue<Body = unknown> implements QueueInterface<Body> {
  readonly #broker: QueueBroker;
  readonly #queueName: string;
  readonly #log?: Log;

  #consumer?: Consumer;

  #messages: Message<Body>[];
  #messageCounter: number;
  #pendingFlush: FlushType;
  #timeout?: NodeJS.Timeout;

  // A callback to run after a flush() has been executed: useful for testing.
  #flushCallback?: () => void;

  constructor(broker: QueueBroker, queueName: string, log?: Log) {
    this.#broker = broker;
    this.#queueName = queueName;
    this.#log = log;

    this.#messages = [];
    this.#messageCounter = 0;
    this.#pendingFlush = FlushType.NONE;
  }

  async send(body: Body, options?: MessageSendOptions): Promise<void> {
    this.#enqueue(body, options);
  }

  async sendBatch(batch: Iterable<MessageSendRequest<Body>>): Promise<void> {
    for (const req of batch) {
      this.#enqueue(req.body, req);
    }
  }

  [kSetConsumer](consumer?: Consumer) {
    if (consumer === undefined) {
      clearTimeout(this.#timeout);
      this.#pendingFlush = FlushType.NONE;
      this.#consumer = undefined;
      return;
    }

    // only allow one subscription per queue (for now)
    if (this.#consumer) {
      throw new QueueError("ERR_CONSUMER_ALREADY_SET");
    }

    this.#consumer = consumer;
    if (this.#messages.length) {
      this.#ensurePendingFlush();
    }
  }

  [kGetConsumer](): Consumer | null {
    return this.#consumer ?? null;
  }

  #enqueue(body: Body, _options?: MessageSendOptions): void {
    const msg = new Message<Body>(
      `${this.#queueName}-${this.#messageCounter}`,
      new Date(),
      body,
      this.#log
    );

    this.#messages.push(msg);
    this.#messageCounter++;
    if (this.#consumer) {
      this.#ensurePendingFlush();
    }
  }

  #ensurePendingFlush() {
    if (!this.#consumer) {
      return;
    }

    // Nothing to do if there is already an immediate flush pending
    if (this.#pendingFlush === FlushType.IMMEDIATE) {
      return;
    }

    if (this.#pendingFlush === FlushType.DELAYED) {
      // Nothing to do if there is already a delayed flush pending and there is no full batch
      if (this.#messages.length < this.#consumer?.maxBatchSize) {
        return;
      }

      // The batch is full now: clear the existing timeout
      clearTimeout(this.#timeout);
      this.#timeout = undefined;
    }

    // Register a new flush timeout with the appropriate delay
    const newFlushType =
      this.#messages.length < this.#consumer.maxBatchSize
        ? FlushType.DELAYED
        : FlushType.IMMEDIATE;
    this.#pendingFlush = newFlushType;

    const delay =
      newFlushType === FlushType.DELAYED ? this.#consumer?.maxWaitMs : 0;

    this.#timeout = setTimeout(() => {
      this.#flush();
      if (this.#flushCallback) {
        this.#flushCallback();
      }
    }, delay);
  }

  async #flush() {
    if (!this.#consumer) {
      return;
    }
    const maxAttempts = this.#consumer.maxRetries + 1;
    const deadLetterQueueName = this.#consumer.deadLetterQueue;

    // Create a batch and execute the queue event handler, making sure to send
    // no more than maxBatchSize messages at a time.
    const msgs = this.#messages.slice(0, this.#consumer.maxBatchSize);
    const batch = new MessageBatch<Body>(this.#queueName, msgs);
    this.#messages = this.#messages.slice(msgs.length);
    try {
      await this.#consumer?.dispatcher(batch);
    } catch (err) {
      this.#log?.error(prefixError(`${this.#queueName} Consumer`, err));
      batch.retryAll();
    }

    // Reset state and check for any messages to retry
    this.#pendingFlush = FlushType.NONE;
    this.#timeout = undefined;

    const toRetry: Message<Body>[] = [];
    const toDLQ: Message<Body>[] = [];
    batch.messages.forEach((msg) => {
      if (!msg[kGetPendingRetry]()) {
        return;
      }

      msg[kPrepareForRetry]();
      if (msg[kGetFailedAttempts]() < maxAttempts) {
        this.#log?.debug(`Retrying message "${msg.id}"...`);
        toRetry.push(msg);
      } else if (deadLetterQueueName) {
        this.#log?.warn(
          `Moving message "${msg.id}" to dead letter queue "${deadLetterQueueName}"...`
        );
        toDLQ.push(msg);
      } else {
        this.#log?.warn(
          `Dropped message "${msg.id}" after ${maxAttempts} failed attempts!`
        );
      }
    });

    if (toRetry.length) {
      this.#messages.push(...toRetry);
    }

    if (this.#messages.length > 0) {
      this.#ensurePendingFlush();
    }

    if (deadLetterQueueName) {
      const deadLetterQueue =
        this.#broker.getOrCreateQueue(deadLetterQueueName);
      toDLQ.forEach((msg) => {
        deadLetterQueue.send(msg.body);
      });
    }
  }

  [kSetFlushCallback](callback: () => void) {
    this.#flushCallback = callback;
  }
}

export class QueueBroker implements QueueBrokerInterface {
  readonly #queues: Map<string, WorkerQueue>;
  readonly #log?: Log;

  constructor(log?: Log) {
    this.#queues = new Map<string, WorkerQueue>();
    this.#log = log;
  }

  getOrCreateQueue(name: string): WorkerQueue {
    let queue = this.#queues.get(name);
    if (queue === undefined) {
      this.#queues.set(name, (queue = new WorkerQueue(this, name, this.#log)));
    }
    return queue;
  }

  resetConsumers() {
    for (const queue of this.#queues.values()) queue[kSetConsumer]();
  }

  setConsumer(queue: WorkerQueue, consumer: Consumer) {
    queue[kSetConsumer](consumer);
  }
}
