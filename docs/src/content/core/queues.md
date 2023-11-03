---
order: 8
---

# 🚥 Queues

- [Queues Reference](https://developers.cloudflare.com/queues/)

## Producers

Specify Queue producers to add to your environment as follows:

import ConfigTabs from "../components/mdx/config-tabs";

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[[queues.producers]]
  queue = "my-queue"
  binding = "MY_QUEUE"
```

```js
const mf = new Miniflare({
  queueProducers: { "MY_QUEUE": "my-queue" },
  queueProducers: ["MY_QUEUE"] // If binding and queue names are the same
});
```

</ConfigTabs>

## Consumers

Specify Workers to consume messages from your Queues as follows:

<ConfigTabs>

```toml
---
filename: wrangler.toml
---
[[queues.consumers]]
  queue = "my-queue"
  max_batch_size = 10
  max_batch_timeout = 30
  max_retries = 10
  dead_letter_queue = "my-queue-dlq"
```

```js
const mf = new Miniflare({
  queueConsumers: {
    "my-queue": {
      maxBatchSize: 5, // default: 5
      maxBatchTimeout: 1 /* second(s) */, // default: 1
      maxRetries: 2, // default: 2
      deadLetterQueue: "my-dead-letter-queue" // default: none
    }
  },
  queueConsumers: ["my-queue"] // If using default consumer options
});
```

</ConfigTabs>