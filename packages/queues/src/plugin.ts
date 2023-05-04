import {
  Consumer as Consumer,
  Context,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  StorageFactory,
} from "@miniflare/shared";

export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_WAIT_MS = 1000;
export const DEFAULT_RETRIES = 2;

export interface BindingOptions {
  name: string;
  queueName: string;
}

export interface ConsumerOptions {
  queueName: string;
  maxBatchSize?: number;
  maxWaitMs?: number;
  maxRetries?: number;
  deadLetterQueue?: string;
}

export interface QueuesOptions {
  queueBindings?: BindingOptions[];
  queueConsumers?: (string | ConsumerOptions)[];
}

export class QueuesPlugin
  extends Plugin<QueuesOptions>
  implements QueuesOptions
{
  @Option({
    type: OptionType.OBJECT,
    name: "queue",
    alias: "q",
    description: "Queue Bindings",
    logName: "Queue Bindings",
    typeFormat: "NAME=QUEUE",
    logValue: (bindings: BindingOptions[]) =>
      bindings.map((b) => b.name).join(", "),
    fromEntries: (entries) =>
      entries.map(([k, v]) => {
        return { name: k, queueName: v };
      }),
    fromWrangler: (wranglerConfig) =>
      wranglerConfig.queues?.producers?.map((b) => {
        return { name: b.binding, queueName: b.queue };
      }),
  })
  queueBindings?: BindingOptions[];

  @Option({
    type: OptionType.ARRAY,
    name: "queue-consumers",
    description: "Queue Consumers",
    logName: "Queue Consumers",
    logValue: (consumers: ConsumerOptions[]) =>
      consumers.map((b) => b.queueName).join(", "),
    fromWrangler: (wranglerConfig) =>
      wranglerConfig.queues?.consumers?.map((opts) => {
        const result: ConsumerOptions = { queueName: opts.queue };
        if (opts.batch_size) {
          result.maxBatchSize = opts.batch_size;
        }
        if (opts.batch_timeout) {
          result.maxWaitMs = 1000 * opts.batch_timeout;
        }
        if (opts.message_retries) {
          result.maxRetries = opts.message_retries;
        }
        if (opts.dead_letter_queue) {
          result.deadLetterQueue = opts.dead_letter_queue;
        }
        return result;
      }),
  })
  queueConsumers?: (string | ConsumerOptions)[];

  readonly #consumers: Consumer[];

  constructor(ctx: PluginContext, options?: QueuesOptions) {
    super(ctx);
    this.assignOptions(options);
    if (options?.queueBindings?.length || options?.queueConsumers?.length) {
      ctx.log.warn(
        "Queues are experimental. There may be breaking changes in the future."
      );
    }

    this.#consumers = (this.queueConsumers ?? []).map((entry) => {
      let opts: ConsumerOptions;
      if (typeof entry === "string") {
        opts = {
          queueName: entry,
        };
      } else {
        opts = entry;
      }

      return {
        queueName: opts.queueName,
        maxBatchSize: opts.maxBatchSize ?? DEFAULT_BATCH_SIZE,
        maxWaitMs: opts.maxWaitMs ?? DEFAULT_WAIT_MS,
        maxRetries: opts.maxRetries ?? DEFAULT_RETRIES,
        deadLetterQueue: opts.deadLetterQueue,
        dispatcher: this.ctx.queueEventDispatcher,
      };
    });
  }

  async setup(_storageFactory: StorageFactory): Promise<SetupResult> {
    const bindings: Context = {};
    for (const binding of this.queueBindings ?? []) {
      bindings[binding.name] = this.ctx.queueBroker.getOrCreateQueue(
        binding.queueName
      );
    }

    const requiresModuleExports = this.#consumers.length > 0;
    return { bindings, requiresModuleExports };
  }

  beforeReload() {
    // Register consumers on every reload, we'll reset them all before running
    // `beforeReload()` hooks. This allows us to detect duplicate consumers
    // across mounts with different `QueuesPlugin` instances.
    for (const consumer of this.#consumers) {
      const queue = this.ctx.queueBroker.getOrCreateQueue(consumer.queueName);
      this.ctx.queueBroker.setConsumer(queue, consumer);
    }
  }
}
