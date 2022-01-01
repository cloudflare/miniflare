import { createHash, webcrypto } from "crypto";
import { WritableStream } from "stream/web";
import { DOMException } from "@miniflare/core";
import { viewToBuffer } from "@miniflare/shared";
import {
  assertsInRequest,
  bufferSourceToArray,
  buildNotBufferSourceError,
  isBufferSource,
} from "./helpers";

// https://developers.cloudflare.com/workers/runtime-apis/web-crypto#supported-algorithms
const supportedDigests = ["sha-1", "sha-256", "sha-384", "sha-512", "md5"];

export class DigestStream extends WritableStream<BufferSource> {
  readonly digest: Promise<ArrayBuffer>;

  constructor(algorithm: AlgorithmIdentifier) {
    // Check algorithm supported by Cloudflare Workers
    let name = typeof algorithm === "string" ? algorithm : algorithm?.name;
    if (!(name && supportedDigests.includes(name.toLowerCase()))) {
      throw new DOMException("Unrecognized name.", "NotSupportedError");
    }
    // createHash expects "shaN" instead of "sha-N"
    name = name.replace("-", "");

    // Create deferred promise to resolve digest once stream is closed
    let digestResolve: (digest: ArrayBuffer) => void;
    const digest = new Promise<ArrayBuffer>((r) => (digestResolve = r));

    // Create hasher and initialise stream
    const hash = createHash(name);
    super({
      write(chunk: unknown) {
        if (isBufferSource(chunk)) {
          hash.update(bufferSourceToArray(chunk));
        } else {
          throw new TypeError(buildNotBufferSourceError(chunk));
        }
      },
      close() {
        digestResolve(viewToBuffer(hash.digest()));
      },
    });

    this.digest = digest;
  }
}

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

export function createCrypto(blockGlobalRandom = false): typeof webcrypto {
  const getRandomValues = assertsInRequest(
    webcrypto.getRandomValues,
    blockGlobalRandom
  );
  const generateKey = assertsInRequest(
    webcrypto.subtle.generateKey,
    blockGlobalRandom
  );

  const subtle = new Proxy(webcrypto.subtle, {
    get(target, propertyKey, receiver) {
      if (propertyKey === "digest") return digest;
      if (propertyKey === "generateKey") return generateKey;
      return Reflect.get(target, propertyKey, receiver);
    },
  });

  return new Proxy(webcrypto, {
    get(target, propertyKey, receiver) {
      if (propertyKey === "getRandomValues") return getRandomValues;
      if (propertyKey === "subtle") return subtle;
      if (propertyKey === "DigestStream") return DigestStream;
      return Reflect.get(target, propertyKey, receiver);
    },
  });
}
