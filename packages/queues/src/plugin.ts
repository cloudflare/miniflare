import {
  Context,
  Option,
  OptionType,
  Plugin,
  PluginContext,
  SetupResult,
  StorageFactory,
  Subscription,
} from "@miniflare/shared";

export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_WAIT_MS = 1000;

export interface BindingOptions {
  name: string;
  queueName: string;
}

export interface SubscriptionOptions {
  queueName: string;
  maxBatchSize?: number;
  maxWaitMs?: number;
}

export interface QueuesOptions {
  queueBindings?: BindingOptions[];
  queueSubscriptions?: (string | SubscriptionOptions)[];
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
      wranglerConfig.queues?.bindings?.map((b) => {
        return { name: b.name, queueName: b.queue_name };
      }),
  })
  queueBindings?: BindingOptions[];

  @Option({
    type: OptionType.ARRAY,
    name: "queue-subscription",
    description: "Queue Subscriptions",
    logName: "Queue Subscriptions",
    logValue: (subscriptions: SubscriptionOptions[]) =>
      subscriptions.map((b) => b.queueName).join(", "),
    fromWrangler: (wranglerConfig) =>
      wranglerConfig.queues?.subscriptions?.map((opts) => {
        const result: SubscriptionOptions = { queueName: opts.queue_name };
        if (opts.max_batch_size) {
          result.maxBatchSize = opts.max_batch_size;
        }
        if (opts.max_wait_secs) {
          result.maxWaitMs = 1000 * opts.max_wait_secs;
        }
        return result;
      }),
  })
  queueSubscriptions?: (string | SubscriptionOptions)[];

  constructor(ctx: PluginContext, options?: QueuesOptions) {
    super(ctx);
    this.assignOptions(options);
  }

  async setup(_storageFactory: StorageFactory): Promise<SetupResult> {
    for (const entry of this.queueSubscriptions ?? []) {
      let opts: SubscriptionOptions;
      if (typeof entry === "string") {
        opts = {
          queueName: entry,
        };
      } else {
        opts = entry;
      }

      const sub: Subscription = {
        queueName: opts.queueName,
        maxBatchSize: opts.maxBatchSize ?? DEFAULT_BATCH_SIZE,
        maxWaitMs: opts.maxWaitMs ?? DEFAULT_WAIT_MS,
        dispatcher: this.ctx.queueEventDispatcher,
      };

      const queue = this.ctx.queueBroker.getOrCreateQueue(opts.queueName);
      this.ctx.queueBroker.setSubscription(queue, sub);
    }

    const bindings: Context = {};
    for (const binding of this.queueBindings ?? []) {
      bindings[binding.name] = this.ctx.queueBroker.getOrCreateQueue(
        binding.queueName
      );
    }
    return { bindings };
  }
}
