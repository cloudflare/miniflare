import {
  Message,
  MessageBatch,
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

enum FlushType {
  NONE,
  DELAYED,
  IMMEDIATE,
}

export class Queue<Body = unknown> implements QueueInterface<Body> {
  #queueName: string;
  #subscription?: Subscription;

  #messages: Message<Body>[];
  #messageCounter: number;
  #pendingFlush: FlushType;
  #timeout?: NodeJS.Timeout;

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
    const retry = () => {
      console.warn(`retry() is unimplemented`);
    };
    const msg: Message<Body> = {
      id: `${this.#queueName}-${this.#messageCounter}`,
      timestamp: new Date(),
      body: body, // TODO(soon) structuredClone the body? (need to support older node versions as well...)
      retry: retry,
    };

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

      // The batch is full now: time to flush immediately
      clearTimeout(this.#timeout);
      this.#pendingFlush = FlushType.IMMEDIATE;
      this.#timeout = setTimeout(() => this.#flush(), 0);
      return;
    }

    // Otherwise, no flush is pending: set up a delayed one
    this.#pendingFlush = FlushType.DELAYED;
    this.#timeout = setTimeout(
      () => this.#flush(),
      this.#subscription?.maxWaitMs
    );
  }

  #flush() {
    if (!this.#subscription) {
      return;
    }

    const batch: MessageBatch<Body> = {
      queue: this.#queueName,
      messages: this.#messages,
      retryAll: () => console.log("retryAll() is unimplemented"),
    };
    this.#subscription?.dispatcher(batch);
    this.#messages = [];
    this.#pendingFlush = FlushType.NONE;
    this.#timeout = undefined;
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
