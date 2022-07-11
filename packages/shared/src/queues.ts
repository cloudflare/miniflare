export const kSetSubscription = Symbol("kSetSubscription");

export type QueueEventDispatcher = (queueName: string, messages: any[]) => void;

export interface Queue {
  send(message: any): void;

  [kSetSubscription](subscription: Subscription): void;
}

export interface QueueBroker {
  getOrCreateQueue(name: string): Queue;

  setSubscription(queue: Queue, subscription: Subscription): void;
}

export type Subscription = {
  queueName: string;
  maxBatchSize: number;
  maxWaitMs: number;
  dispatcher: QueueEventDispatcher;
};
