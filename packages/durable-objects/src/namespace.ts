import { createHash, webcrypto } from "crypto";
import { URL } from "url";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
  withImmutableHeaders,
  withInputGating,
} from "@miniflare/core";
import {
  Context,
  InputGate,
  MaybePromise,
  OutputGate,
} from "@miniflare/shared";
import { DurableObjectStorage } from "./storage";

function hexEncode(value: Uint8Array): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const kObjectName = Symbol("kObjectName");

export class DurableObjectId {
  readonly [kObjectName]: string;
  readonly #hexId: string;

  constructor(objectName: string, hexId: string, readonly name?: string) {
    this[kObjectName] = objectName;
    this.#hexId = hexId;
  }

  equals(other: DurableObjectId): boolean {
    // noinspection SuspiciousTypeOfGuard
    if (!(other instanceof DurableObjectId)) return false;
    return this.#hexId === other.#hexId;
  }

  toString(): string {
    return this.#hexId;
  }
}

export interface DurableObjectConstructor {
  new (state: DurableObjectState, env: Context): DurableObject;
}

export interface DurableObject {
  fetch(request: Request): MaybePromise<Response>;
}

export const kInstance = Symbol("kInstance");
const kFetch = Symbol("kFetch");

export class DurableObjectState {
  #inputGate = new InputGate();
  [kInstance]?: DurableObject;

  constructor(
    readonly id: DurableObjectId,
    readonly storage: DurableObjectStorage
  ) {}

  waitUntil(_promise: Promise<void>): void {}

  blockConcurrencyWhile<T>(closure: () => Promise<T>): Promise<T> {
    // TODO: catch, reset object on error
    return this.#inputGate.runWithClosed(closure);
  }

  [kFetch](request: Request): Promise<Response> {
    // TODO: catch, reset object on error
    const outputGate = new OutputGate();
    return outputGate.runWith(() =>
      this.#inputGate.runWith(() => this[kInstance]!.fetch(request))
    );
  }
}

export type DurableObjectFactory = (
  id: DurableObjectId
) => Promise<DurableObjectState>;

export class DurableObjectStub {
  readonly #factory: DurableObjectFactory;

  constructor(factory: DurableObjectFactory, readonly id: DurableObjectId) {
    this.#factory = factory;
  }

  get name(): string | undefined {
    return this.id.name;
  }

  // TODO: check websocket requests work here
  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    // Get object
    const state = await this.#factory(this.id);

    // Make sure relative URLs prefixed with https://fake-host
    if (typeof input === "string") input = new URL(input, "https://fake-host");
    const request =
      input instanceof Request && !init ? input : new Request(input, init);
    return state[kFetch](withInputGating(withImmutableHeaders(request)));
  }
}

export interface NewUniqueIdOptions {
  jurisdiction?: string; // Ignored
}

const HEX_ID_REGEXP = /^[A-Za-z0-9]{64}$/; // 64 hex digits

export class DurableObjectNamespace {
  readonly #objectName: string;
  readonly #factory: DurableObjectFactory;
  readonly #objectNameHash: Uint8Array;
  readonly #objectNameHashHex: string;

  constructor(objectName: string, factory: DurableObjectFactory) {
    this.#objectName = objectName;
    this.#factory = factory;

    // Calculate first 8 bytes of SHA-256 hash of objectName, IDs for objectName
    // must end with this
    this.#objectNameHash = createHash("sha256")
      .update(this.#objectName)
      .digest()
      .slice(0, 8);
    this.#objectNameHashHex = hexEncode(this.#objectNameHash);
  }

  newUniqueId(_options: NewUniqueIdOptions): DurableObjectId {
    // Create new zero-filled 32 byte buffer
    const id = new Uint8Array(32);
    // Leave first byte as 0, ensuring no intersection with named IDs
    // ...then write current time in 8 bytes
    const view = new DataView(id);
    view.setBigUint64(1, BigInt(Date.now()));
    // ...then fill 15 (32 - 1 - 8 - 8) bytes with random data
    webcrypto.getRandomValues(new Uint8Array(id.buffer, 9, 15));
    // ...then copy objectName hash
    id.set(this.#objectNameHash, 24 /* 32 - 8 */);
    return new DurableObjectId(this.#objectName, hexEncode(id));
  }

  idFromName(name: string): DurableObjectId {
    const id: Uint8Array = createHash("sha256")
      .update(this.#objectName)
      .update(name)
      .digest();
    // Force first bit to be 1, ensuring no intersection with unique IDs
    id[0] |= 0b1000_0000;
    // ...then copy objectName hash
    id.set(this.#objectNameHash, 24 /* 32 - 8 */);
    return new DurableObjectId(this.#objectName, hexEncode(id), name);
  }

  idFromString(hexId: string): DurableObjectId {
    if (!HEX_ID_REGEXP.test(hexId)) {
      throw new TypeError(
        "Invalid Durable Object ID. Durable Object IDs must be 64 hex digits."
      );
    }
    // It's important we check this here in addition to `get` below, as the ID
    // might be used in a call to `Miniflare#getDurableObjectStorage` which
    // doesn't check this. Other ways of creating an ID (apart from using the
    // constructor) will always have the correct hash.
    if (!hexId.endsWith(this.#objectNameHashHex)) {
      throw new TypeError(
        "Invalid Durable Object ID. The ID does not match this Durable Object class."
      );
    }
    return new DurableObjectId(this.#objectName, hexId.toLowerCase());
  }

  get(id: DurableObjectId): DurableObjectStub {
    if (
      id[kObjectName] !== this.#objectName ||
      !id.toString().endsWith(this.#objectNameHashHex)
    ) {
      throw new TypeError("ID is not for this Durable Object class.");
    }
    return new DurableObjectStub(this.#factory, id);
  }
}
