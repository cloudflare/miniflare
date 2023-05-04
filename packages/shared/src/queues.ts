// Internal types:

export const kGetConsumer = Symbol("kGetConsumer");
export const kSetConsumer = Symbol("kSetConsumer");

export type QueueEventDispatcher = (batch: MessageBatch) => Promise<void>;

export interface QueueBroker {
  getOrCreateQueue(name: string): Queue;

  setConsumer(queue: Queue, consumer: Consumer): void;
  resetConsumers(): void;
}

export interface Consumer {
  queueName: string;
  maxBatchSize: number;
  maxWaitMs: number;
  maxRetries: number;
  deadLetterQueue?: string;
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

  [kSetConsumer](consumer?: Consumer): void;
  [kGetConsumer](): Consumer | null;
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
