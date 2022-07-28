export type Message<Body = unknown> = {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  retry(): void;
};

export type MessageBatch<Body = unknown> = {
  readonly queue: string;
  readonly messages: Message<Body>[];
  retryAll(): void;
};

export interface Env {}

export default {
  async queue(
    batch: MessageBatch<string>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`consumer.queue() received batch from queue "${batch.queue}":`);

    for (const msg of batch.messages) {
      console.log(`\t${msg.timestamp} (${msg.id}): ${msg.body}`);
    }
  },
};
