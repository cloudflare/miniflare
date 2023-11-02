---
order: 8
---

# 🚥 Queues

- [Queues Reference](https://developers.cloudflare.com/queues/)

## Producers

`queueProducers`

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
  queueProducers: [""],
});
```

</ConfigTabs>

## Consumers

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
  queueConsumers: {"", {
    maxBatchSize: 5, // default: 5
    maxBatchTimeout: 1/* seconds */, // default: 1
    maxRetries: 2, // default: 2
    deadLetterQueue: "" // default: none
  }
  }
});
```

</ConfigTabs>