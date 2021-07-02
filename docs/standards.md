# 🕸 Web Standards

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
- **Streams:** `ByteLengthQueuingStrategy`, `CountQueuingStrategy`,
  `ReadableByteStreamController`, `ReadableStream`, `ReadableStreamBYOBReader`,
  `ReadableStreamBYOBRequest`, `ReadableStreamDefaultController`,
  `ReadableStreamDefaultReader`, `TransformStream`,
  `TransformStreamDefaultController`, `WritableStream`,
  `WritableStreamDefaultController`, `WritableStreamDefaultWriter` (powered by
  [web-streams-polyfill](https://github.com/MattiasBuelens/web-streams-polyfill))
