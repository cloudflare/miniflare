---
order: 6
---

# 🕸 Web Standards

- [Web Standards Reference](https://developers.cloudflare.com/workers/runtime-apis/web-standards)
- [Encoding Reference](https://developers.cloudflare.com/workers/runtime-apis/encoding)
- [Fetch Reference](https://developers.cloudflare.com/workers/runtime-apis/fetch)
- [Request Reference](https://developers.cloudflare.com/workers/runtime-apis/request)
- [Response Reference](https://developers.cloudflare.com/workers/runtime-apis/response)
- [Streams Reference](https://developers.cloudflare.com/workers/runtime-apis/streams)
- [Using Streams](https://developers.cloudflare.com/workers/learning/using-streams)
- [Web Crypto Reference](https://developers.cloudflare.com/workers/runtime-apis/web-crypto)

Miniflare supports the following Web Standards in its sandbox:

- **Console:** `console.*`
- **Timers:** `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`,
  `queueMicrotask`
- **Base64:** `atob`, `btoa`
- **Web Crypto**: `crypto.getRandomValues`, `crypto.randomUUID`,
  `crypto.subtle.*` (with support for `MD5` digests and `NODE-ED25519`
  signatures)
- **Encoding:** `TextEncoder`, `TextDecoder`
- **Fetch:** `fetch`, `Headers` (including
  [non-standard `getAll` method](https://developers.cloudflare.com/workers/runtime-apis/headers#differences)),
  `Request`, `Response`, `FormData`, `Blob`, `File`, `URL`, `URLSearchParams`
  (powered by [`undici`](https://github.com/nodejs/undici/))
- **Streams:** `ByteLengthQueuingStrategy`, `CountQueuingStrategy`,
  `ReadableByteStreamController`, `ReadableStream`, `ReadableStreamBYOBReader`
  (including non-standard `readAtLeast` method), `ReadableStreamBYOBRequest`,
  `ReadableStreamDefaultController`, `ReadableStreamDefaultReader`,
  `TransformStream`, `TransformStreamDefaultController`, `WritableStream`,
  `WritableStreamDefaultController`, `WritableStreamDefaultWriter`
- **Events:** `Event`, `EventTarget`, `AbortController`, `AbortSignal`
- **Event Types:** `fetch`, `scheduled`, `unhandledrejection`,
  `rejectionhandled`
- **Misc:** `structuredClone`
