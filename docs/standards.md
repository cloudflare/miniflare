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
- **Timers:** `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`
- **Base64:** `atob`, `btoa`
- **Web Crypto**: `crypto.*` (powered by
  [@peculiar/webcrypto](https://github.com/PeculiarVentures/webcrypto) with
  extra MD5 digest support)
- **Encoding:** `TextEncoder`, `TextDecoder`
- **Fetch:** `fetch`, `Headers`, `Request`, `Response` (powered by
  [@mrbbot/node-fetch](https://github.com/mrbbot/node-fetch/))
- **URL:** `URL`, `URLSearchParams`
- **Form Data:** `FormData` (powered by
  [formdata-node](https://github.com/octet-stream/form-data))
- **Streams:** `ByteLengthQueuingStrategy`, `CountQueuingStrategy`,
  `ReadableByteStreamController`, `ReadableStream`, `ReadableStreamBYOBReader`,
  `ReadableStreamBYOBRequest`, `ReadableStreamDefaultController`,
  `ReadableStreamDefaultReader`, `TransformStream`,
  `TransformStreamDefaultController`, `WritableStream`,
  `WritableStreamDefaultController`, `WritableStreamDefaultWriter` (powered by
  [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill))
- **Events:** `Event`, `EventTarget` (powered by
  [event-target-shim](https://github.com/mysticatea/event-target-shim))
