import { createHash, webcrypto } from "crypto";

function digest(
  algorithm: AlgorithmIdentifier,
  data: BufferSource
): Promise<ArrayBuffer> {
  const algorithmName =
    typeof algorithm === "string" ? algorithm : algorithm?.name;
  if (algorithmName?.toLowerCase() == "md5") {
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    return Promise.resolve(
      createHash("md5")
        .update(data as any)
        .digest().buffer
    );
  }

  // If the algorithm isn't MD5, defer to the original function
  return webcrypto.subtle.digest(algorithm, data);
}

const subtle = new Proxy(webcrypto.subtle, {
  get(target, propertyKey, receiver): any {
    if (propertyKey === "digest") return digest;
    return Reflect.get(target, propertyKey, receiver);
  },
});

export const crypto = new Proxy(webcrypto, {
  get(target, propertyKey, receiver): any {
    if (propertyKey === "subtle") return subtle;
    return Reflect.get(target, propertyKey, receiver);
  },
});
