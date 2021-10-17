import { createHash, webcrypto } from "crypto";
import { viewToBuffer } from "@miniflare/shared";

// Workers support non-standard MD5 digests
function digest(
  algorithm: AlgorithmIdentifier,
  data: BufferSource
): Promise<ArrayBuffer> {
  const name = typeof algorithm === "string" ? algorithm : algorithm?.name;
  if (name?.toLowerCase() == "md5") {
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    const hash = createHash("md5").update(data as any);
    return Promise.resolve(viewToBuffer(hash.digest()));
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
