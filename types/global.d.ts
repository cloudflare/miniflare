declare global {
  // TODO(soon): remove once included in `@types/node`
  // eslint-disable-next-line no-var
  var CryptoKey: typeof import("crypto").webcrypto.CryptoKey;
}

export {};
