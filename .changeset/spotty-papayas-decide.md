---
"@miniflare/cache": patch
---

In order to allow policy.storable to return true in line with cloudflare's cache
API, default both the 429 and 503 status codes to be 200.
