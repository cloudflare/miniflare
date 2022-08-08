// Internal types:

export const kGetSubscription = Symbol("kGetSubscription");
export const kSetSubscription = Symbol("kSetSubscription");

export type QueueEventDispatcher = (batch: MessageBatch) => Promise<void>;

export interface QueueBroker {
  getOrCreateQueue(name: string): Queue;

  setSubscription(queue: Queue, subscription: Subscription): void;
}

export interface Subscription {
  queueName: string;
  maxBatchSize: number;
  maxWaitMs: number;
  dispatcher: QueueEventDispatcher;
}

// External types (exposed to user code):
export type MessageSendOptions = {
  // Reserved
};

export type MessageSendRequest<Body = unknown> = {
  body: Body;
} & MessageSendOptions;

export interface Queue<Body = unknown> {
  send(message: Body, options?: MessageSendOptions): Promise<void>;
  sendBatch(batch: Iterable<MessageSendRequest<Body>>): Promise<void>;

  [kSetSubscription](subscription: Subscription): void;
  [kGetSubscription](): Subscription | null;
}

export interface Message<Body = unknown> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  retry(): void;
}

export interface MessageBatch<Body = unknown> {
  readonly queue: string;
  readonly messages: Message<Body>[];
  retryAll(): void;
}
