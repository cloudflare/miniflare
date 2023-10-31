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
compatibility_flags = [
  "formdata_parser_supports_files",
  "durable_object_fetch_allows_relative_url"
]
```

```js
const mf = new Miniflare({
  queueConsumers: {"", {
    maxBatchSize: 5, // default: 5
    maxBatchTimeout: 1/* seconds */, // default: 1
    maxRetries: 2, // default: 2
    deadLetterQueue: "" // default: none
}
  }}
});
```

</ConfigTabs>