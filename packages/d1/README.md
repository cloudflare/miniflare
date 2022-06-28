# `@miniflare/d1`

Workers D1 module for [Miniflare](https://github.com/cloudflare/miniflare): a
fun, full-featured, fully-local simulator for Cloudflare Workers. See
[📦 D1](https://miniflare.dev/storage/d1) for more details.

## Example

```js
import { BetaDatabase } from "@miniflare/d1";
import { MemoryStorage } from "@miniflare/storage-memory";
var db = new BetaDatabase(new MemoryStorage());

// BetaDatabase only supports .fetch(), once D1 is out of beta the full API will be available here:
await db.fetch("/execute", {
  method: 'POST',
  body: JSON.stringify({
    sql: `CREATE TABLE my_table (cid INTEGER PRIMARY KEY, name TEXT NOT NULL);`,
  }),
});
const response = await db.fetch("/query", {
  method: 'POST',
  body: JSON.stringify({
    sql: `SELECT * FROM sqlite_schema`,
  }),
});
console.log(await response.json())
/*
{
  "success": true,
  "result": [
    [
      {
        "type": "table",
        "name": "my_table",
        "tbl_name": "my_table",
        "rootpage": 2,
        "sql": "CREATE TABLE my_table (cid INTEGER PRIMARY KEY, name TEXT NOT NULL)"
      }
    ]
  ]
}
*/
```
