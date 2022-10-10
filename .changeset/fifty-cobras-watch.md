---
"@miniflare/core": patch
---

feat: Add support for `TextEncoderStream`/`TextDecoderStream`

These were added in Node 16.6.0
(https://nodejs.org/api/webstreams.html#class-textencoderstream) which is below
our minimum supported Node version, so we just expose theirs.
