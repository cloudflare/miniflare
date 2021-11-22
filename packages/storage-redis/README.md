# `@miniflare/storage-redis`

Redis storage module for [Miniflare](https://github.com/cloudflare/miniflare): a
fun, full-featured, fully-local simulator for Cloudflare Workers.

## Example

```js
import { KVNamespace } from "@miniflare/kv";
import { RedisStorage } from "@miniflare/storage-redis";
import IORedis from "ioredis";

const redis = new IORedis("redis://localhost:6379");
const ns = new KVNamespace(new RedisStorage(redis, "namespace"));
await ns.put("key", "value");
console.log(await ns.get("key")); // value
```
