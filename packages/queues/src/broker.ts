import {
  MessageBatch as MessageBatchInterface,
  Message as MessageInterface,
  MessageSendOptions,
  MessageSendRequest,
  MiniflareError,
  QueueBroker as QueueBrokerInterface,
  Queue as QueueInterface,
  Subscription,
  kGetSubscription,
  kSetSubscription,
} from "@miniflare/shared";

export type QueueErrorCode = "ERR_SUBSCRIBER_ALREADY_SET";

export class QueueError extends MiniflareError<QueueErrorCode> {}

export const MAX_ATTEMPTS = 3;
const kShouldAttemptRetry = Symbol("kShouldAttemptRetry");

export class Message<Body = unknown> implements MessageInterface<Body> {
  readonly body: Body;

  // Internal state for tracking retries
  // Eventually, this will need to be moved or modified to support
  // multiple subscribers on a single queue.
  #pendingRetry: boolean;
  #failedAttempts: number;

  constructor(readonly id: string, readonly timestamp: Date, body: Body) {
    this.body = body; // TODO(soon) structuredClone the body? (need to support older node versions as well...)

    this.#pendingRetry = false;
    this.#failedAttempts = 0;
  }

  retry(): void {
    this.#pendingRetry = true;
  }

  [kShouldAttemptRetry](): boolean {
    if (!this.#pendingRetry) {
      return false;
    }

    this.#failedAttempts++;
    if (this.#failedAttempts >= MAX_ATTEMPTS) {
      // TODO(soon) use the miniflare Logger
      console.warn(
        `Dropping message "${this.id}" after ${
          this.#failedAttempts
        } failed attempts`
      );
      return false;
    }

    console.log(`Retrying message "${this.id}"`);
    this.#pendingRetry = false;
    return true;
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

export class Queue<Body = unknown> implements QueueInterface<Body> {
  #queueName: string;
  #subscription?: Subscription;

  #messages: Message<Body>[];
  #messageCounter: number;
  #pendingFlush: FlushType;
  #timeout?: NodeJS.Timeout;

  // A callback to run after a flush() has been executed: useful for testing.
  #flushCallback?: () => void;

  constructor(queueName: string) {
    this.#queueName = queueName;

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

  [kSetSubscription](subscription: Subscription) {
    // only allow one subscription per queue (for now)
    if (this.#subscription) {
      throw new QueueError("ERR_SUBSCRIBER_ALREADY_SET");
    }

    this.#subscription = subscription;
    if (this.#messages.length) {
      this.#ensurePendingFlush();
    }
  }

  [kGetSubscription](): Subscription | null {
    return this.#subscription ?? null;
  }

  #enqueue(body: Body, _options?: MessageSendOptions): void {
    const msg = new Message<Body>(
      `${this.#queueName}-${this.#messageCounter}`,
      new Date(),
      body
    );

    this.#messages.push(msg);
    this.#messageCounter++;
    if (this.#subscription) {
      this.#ensurePendingFlush();
    }
  }

  #ensurePendingFlush() {
    if (!this.#subscription) {
      return;
    }

    // Nothing to do if there is already an immediate flush pending
    if (this.#pendingFlush === FlushType.IMMEDIATE) {
      return;
    }

    if (this.#pendingFlush === FlushType.DELAYED) {
      // Nothing to do if there is already a delayed flush pending and there is no full batch
      if (this.#messages.length < this.#subscription?.maxBatchSize) {
        return;
      }

      // The batch is full now: clear the existing timeout
      clearTimeout(this.#timeout);
      this.#timeout = undefined;
    }

    // Register a new flush timeout with the appropriate delay
    const newFlushType =
      this.#messages.length < this.#subscription.maxBatchSize
        ? FlushType.DELAYED
        : FlushType.IMMEDIATE;
    this.#pendingFlush = newFlushType;

    const delay =
      newFlushType === FlushType.DELAYED ? this.#subscription?.maxWaitMs : 0;

    this.#timeout = setTimeout(() => {
      this.#flush();
      if (this.#flushCallback) {
        this.#flushCallback();
      }
    }, delay);
  }

  async #flush() {
    if (!this.#subscription) {
      return;
    }

    // Create a batch and execute the queue event handler
    // TODO(soon) detect exceptions raised by the event handler, and retry the whole batch
    const batch = new MessageBatch<Body>(this.#queueName, [...this.#messages]);
    this.#messages = [];
    await this.#subscription?.dispatcher(batch);

    // Reset state and check for any messages to retry
    this.#pendingFlush = FlushType.NONE;
    this.#timeout = undefined;
    const messagesToRetry = batch.messages.filter((msg) =>
      msg[kShouldAttemptRetry]()
    );
    this.#messages.push(...messagesToRetry);
    if (this.#messages.length > 0) {
      this.#ensurePendingFlush();
    }
  }

  [kSetFlushCallback](callback: () => void) {
    this.#flushCallback = callback;
  }
}

export class QueueBroker implements QueueBrokerInterface {
  #queues: Map<string, Queue>;

  constructor() {
    this.#queues = new Map<string, Queue>();
  }

  getOrCreateQueue(name: string): Queue {
    let queue = this.#queues.get(name);
    if (queue === undefined) this.#queues.set(name, (queue = new Queue(name)));
    return queue;
  }

  setSubscription(queue: Queue, subscription: Subscription) {
    queue[kSetSubscription](subscription);
  }
}
