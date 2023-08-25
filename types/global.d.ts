declare global {
  // TODO(soon): remove once included in `@types/node`
  // eslint-disable-next-line no-var
  var CryptoKey: typeof import("crypto").webcrypto.CryptoKey;
  // eslint-disable-next-line no-var
  var MessagePort: typeof import("worker_threads").MessagePort;
  // eslint-disable-next-line no-var
  type WebSocket = unknown;
}

export {};
