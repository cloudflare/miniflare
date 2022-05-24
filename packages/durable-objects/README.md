# `@miniflare/durable-objects`

Durable Objects module for [Miniflare](https://github.com/cloudflare/miniflare):
a fun, full-featured, fully-local simulator for Cloudflare Workers. See
[📌 Durable Objects](https://miniflare.dev/storage/durable-objects) for more
details.

## Example

```js
import { DurableObjectStorage } from "@miniflare/durable-objects";
import { MemoryStorage } from "@miniflare/storage-memory";

const storage = new DurableObjectStorage(new MemoryStorage());
await storage.put("key", "value");
console.log(await storage.get("key")); // value
```

## Alarms

```js
import { DurableObjectStorage, AlarmStore } from "@miniflare/durable-objects";
import { MemoryStorage } from "@miniflare/storage-memory";

const alarmStore = new AlarmStore();
const storage = new DurableObjectStorage(new MemoryStorage(), alarmStore);

// set an alarm 5 seconds from now
await storage.setAlarm(Date.now() + 5 * 1000)
console.log(await storage.getAlarm()); // time in milliseconds
```

## Flags

```
Durable Objects Options:
 -o, --do                Durable Object to bind                             [array:NAME=CLASS[@MOUNT]]
     --do-persist        Persist Durable Object data (to optional path)               [boolean/string]
     --do-ignore-alarms  Durable Objects will not monitor or trigger alarms.          [boolean]
```


## Acknowledgements

Durable Object's transactions are implemented using Optimistic Concurrency
Control (OCC) as described in
["On optimistic methods for concurrency control." ACM Transactions on Database Systems](https://dl.acm.org/doi/10.1145/319566.319567).
Thanks to [Alistair O'Brien](https://github.com/johnyob) for helping the
Miniflare creator understand this.
