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

## Using the Plugin

```js
import { Compatibility, NoOpLog, PluginContext } from "@miniflare/shared";

// prep the context
const log = new NoOpLog();
const compat = new Compatibility();
const rootPath = process.cwd();
const ctx: PluginContext = { log, compat, rootPath };

// build the plugin
const plugin = new DurableObjectsPlugin(ctx, {
  durableObjects: { TEST: "TestObject" }, // add the DOs
  durableObjectsPersist: true, // enable data persistence [boolean | string]
  ignoreAlarms: false, // set to true to ignore alarms
});
```

## Alarms

### Example

```js
import { DurableObjectStorage, AlarmStore } from "@miniflare/durable-objects";
import { MemoryStorage } from "@miniflare/storage-memory";

const alarmStore = new AlarmStore();
const storage = new DurableObjectStorage(new MemoryStorage(), alarmStore);

// set an alarm 5 seconds from now
await storage.setAlarm(Date.now() + 5 * 1000);
console.log(await storage.getAlarm()); // time in milliseconds
await storageg.deleteAlarm();
```

### Functions

#### getAlarm(): `Promise<number>`
 * get the alarm time in milliseconds from epoch

#### setAlarm(scheduledTime: Date | number, options?: DurableObjectSetAlarmOptions): `Promise<void>`
 * scheduledTime - If number, must be in milliseconds from epoch.
 * options - set `allowConcurrency` and/or `allowUnconfirmed`

#### deleteAlarm(): `Promise<void>`
 * clear the alarm

```ts
interface DurableObjectSetAlarmOptions {
  allowConcurrency?: boolean;
  allowUnconfirmed?: boolean;
}
```


## Acknowledgements

Durable Object's transactions are implemented using Optimistic Concurrency
Control (OCC) as described in
["On optimistic methods for concurrency control." ACM Transactions on Database Systems](https://dl.acm.org/doi/10.1145/319566.319567).
Thanks to [Alistair O'Brien](https://github.com/johnyob) for helping the
Miniflare creator understand this.
