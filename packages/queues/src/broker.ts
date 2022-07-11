import {
  MiniflareError,
  QueueBroker as QueueBrokerInterface,
  Queue as QueueInterface,
  Subscription,
  kSetSubscription,
} from "@miniflare/shared";

export type QueueErrorCode = "ERR_SUBSCRIBER_ALREADY_SET";

export class QueueError extends MiniflareError<QueueErrorCode> {}

enum FlushType {
  NONE,
  DELAYED,
  IMMEDIATE,
}

export class Queue implements QueueInterface {
  #queueName: string;
  subscription?: Subscription;

  #messages: any[];
  #pendingFlush: FlushType;
  #timeout?: NodeJS.Timeout;

  constructor(queueName: string) {
    this.#queueName = queueName;

    this.#messages = [];
    this.#pendingFlush = FlushType.NONE;
  }

  send(message: any) {
    this.#messages.push(message);
    if (this.subscription) {
      this.#ensurePendingFlush();
    }
  }

  [kSetSubscription](subscription: Subscription) {
    // only allow one subscription per queue (for now)
    if (this.subscription) {
      throw new QueueError("ERR_SUBSCRIBER_ALREADY_SET");
    }

    this.subscription = subscription;
    if (this.#messages.length) {
      this.#ensurePendingFlush();
    }
  }

  #ensurePendingFlush() {
    if (!this.subscription) {
      return;
    }

    // Nothing to do if there is already an immediate flush pending
    if (this.#pendingFlush === FlushType.IMMEDIATE) {
      return;
    }

    if (this.#pendingFlush === FlushType.DELAYED) {
      // Nothing to do if there is already a delayed flush pending and there is no full batch
      if (this.#messages.length < this.subscription?.maxBatchSize) {
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
      this.subscription?.maxWaitMs
    );
  }

  #flush() {
    if (!this.subscription) {
      return;
    }

    this.subscription?.dispatcher(this.#queueName, this.#messages);
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
