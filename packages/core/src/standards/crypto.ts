import { createHash, timingSafeEqual, webcrypto } from "crypto";
import { WritableStream } from "stream/web";
import { viewToBuffer } from "@miniflare/shared";
import { DOMException } from "./domexception";
import {
  assertsInRequest,
  bufferSourceToArray,
  buildNotBufferSourceError,
  isBufferSource,
} from "./helpers";

// `CryptoKey` is global in Node 19+:
// https://nodejs.org/api/globals.html#cryptokey
export const CryptoKey = globalThis.CryptoKey ?? webcrypto.CryptoKey;

// https://developers.cloudflare.com/workers/runtime-apis/web-crypto#supported-algorithms
const supportedDigests = ["sha-1", "sha-256", "sha-384", "sha-512", "md5"];

export class DigestStream extends WritableStream<BufferSource> {
  readonly digest: Promise<ArrayBuffer>;

  constructor(algorithm: webcrypto.AlgorithmIdentifier) {
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

const usesModernEd25519 = (async () => {
  try {
    // Modern versions of Node.js expect `Ed25519` instead of `NODE-ED25519`.
    // This will throw a `DOMException` if `NODE-ED25519` should be used
    // instead. See https://github.com/nodejs/node/pull/42507.
    await webcrypto.subtle.generateKey(
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign", "verify"]
    );
    return true;
  } catch {
    return false;
  }
})();

async function ensureValidNodeAlgorithm(
  algorithm: webcrypto.AlgorithmIdentifier | webcrypto.EcKeyAlgorithm
): Promise<webcrypto.AlgorithmIdentifier | webcrypto.EcKeyAlgorithm> {
  // "X448" and "Ed448" are not supported by Workers
  if (
    typeof algorithm === "object" &&
    (algorithm.name === "X448" || algorithm.name === "Ed448")
  ) {
    throw new DOMException("Unrecognized name.", "NotSupportedError");
  }
  if (
    typeof algorithm === "object" &&
    algorithm.name === "Ed25519" &&
    !(await usesModernEd25519)
  ) {
    return { name: "NODE-ED25519", namedCurve: "NODE-ED25519" };
  }
  if (
    typeof algorithm === "object" &&
    algorithm.name === "NODE-ED25519" &&
    "namedCurve" in algorithm &&
    algorithm.namedCurve === "NODE-ED25519" &&
    (await usesModernEd25519)
  ) {
    return { name: "Ed25519", namedCurve: "Ed25519" };
  }
  return algorithm;
}

function ensureValidWorkerKey(key: webcrypto.CryptoKey): webcrypto.CryptoKey {
  // Users' workers will expect to see the `Ed25519` algorithm, even if we're
  // using on an old Node version and using "Ed25519" internally
  if (key.algorithm.name === "NODE-ED25519") key.algorithm.name = "Ed25519";
  return key;
}

async function ensureValidNodeKey(
  key: webcrypto.CryptoKey
): Promise<webcrypto.CryptoKey> {
  if (key.algorithm.name === "Ed25519" && !(await usesModernEd25519)) {
    return new Proxy(key, {
      get(target, property, receiver) {
        if (property === "algorithm") return { name: "NODE-ED25519" };
        return Reflect.get(target, property, receiver);
      },
    });
  }
  return key;
}

// Workers support non-standard MD5 digests, see
// https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#supported-algorithms
const digest: typeof webcrypto.subtle.digest = function (algorithm, data) {
  const name = typeof algorithm === "string" ? algorithm : algorithm?.name;
  if (name?.toLowerCase() == "md5") {
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    const hash = createHash("md5").update(data as any);
    return Promise.resolve(viewToBuffer(hash.digest()));
  }

  // If the algorithm isn't MD5, defer to the original function
  return webcrypto.subtle.digest(algorithm, data);
};

// Workers support the NODE-ED25519 algorithm, unlike modern Node versions, see
// https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#supported-algorithms
const generateKey: typeof webcrypto.subtle.generateKey = async function (
  algorithm,
  extractable,
  keyUsages
) {
  algorithm = await ensureValidNodeAlgorithm(algorithm);
  const key: webcrypto.CryptoKey | webcrypto.CryptoKeyPair =
    // @ts-expect-error TypeScript cannot infer the correct overload here
    await webcrypto.subtle.generateKey(algorithm, extractable, keyUsages);
  // noinspection SuspiciousTypeOfGuard
  if (key instanceof CryptoKey) {
    return ensureValidWorkerKey(key);
  } else {
    key.publicKey = ensureValidWorkerKey(key.publicKey);
    key.privateKey = ensureValidWorkerKey(key.privateKey);
    return key as any;
  }
};
const importKey: typeof webcrypto.subtle.importKey = async function (
  format,
  keyData,
  algorithm,
  extractable,
  keyUsages
) {
  // Cloudflare Workers only allow importing *public* raw Ed25519 keys, see
  // https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#supported-algorithms
  const forcePublic =
    format === "raw" &&
    typeof algorithm === "object" &&
    algorithm.name === "NODE-ED25519" &&
    "namedCurve" in algorithm &&
    algorithm.namedCurve === "NODE-ED25519";

  algorithm = await ensureValidNodeAlgorithm(algorithm);

  // @ts-expect-error `public` isn't included in the definitions, but required
  // for marking `keyData` as public key material
  if (forcePublic) algorithm.public = true;

  const key = await webcrypto.subtle.importKey(
    // @ts-expect-error TypeScript cannot infer the correct overload here
    format,
    keyData,
    algorithm,
    extractable,
    keyUsages
  );
  return ensureValidWorkerKey(key);
};
const exportKey: typeof webcrypto.subtle.exportKey = async function (
  format,
  key
) {
  key = await ensureValidNodeKey(key);
  // @ts-expect-error TypeScript cannot infer the correct overload here
  return webcrypto.subtle.exportKey(format, key);
};
const sign: typeof webcrypto.subtle.sign = async function (
  algorithm,
  key,
  data
) {
  algorithm = await ensureValidNodeAlgorithm(algorithm);
  key = await ensureValidNodeKey(key);
  return webcrypto.subtle.sign(algorithm, key, data);
};
const verify: typeof webcrypto.subtle.verify = async function (
  algorithm,
  key,
  signature,
  data
) {
  algorithm = await ensureValidNodeAlgorithm(algorithm);
  key = await ensureValidNodeKey(key);
  return webcrypto.subtle.verify(algorithm, key, signature, data);
};

export type WorkerCrypto = typeof webcrypto & {
  DigestStream: typeof DigestStream;
};

export function createCrypto(blockGlobalRandom = false): WorkerCrypto {
  const assertingGetRandomValues = assertsInRequest(
    webcrypto.getRandomValues.bind(webcrypto),
    blockGlobalRandom
  );
  const assertingGenerateKey = assertsInRequest(generateKey, blockGlobalRandom);

  const subtle = new Proxy(webcrypto.subtle, {
    get(target, propertyKey, receiver) {
      if (propertyKey === "digest") return digest;
      if (propertyKey === "generateKey") return assertingGenerateKey;
      if (propertyKey === "importKey") return importKey;
      if (propertyKey === "exportKey") return exportKey;
      if (propertyKey === "sign") return sign;
      if (propertyKey === "timingSafeEqual") return timingSafeEqual;
      if (propertyKey === "verify") return verify;

      let result = Reflect.get(target, propertyKey, receiver);
      if (typeof result === "function") result = result.bind(webcrypto.subtle);
      return result;
    },
  });

  return new Proxy(webcrypto as WorkerCrypto, {
    get(target, propertyKey, receiver) {
      if (propertyKey === "getRandomValues") return assertingGetRandomValues;
      if (propertyKey === "subtle") return subtle;
      if (propertyKey === "DigestStream") return DigestStream;

      let result = Reflect.get(target, propertyKey, receiver);
      if (typeof result === "function") result = result.bind(webcrypto);
      return result;
    },
  });
}
