import { createHash, webcrypto } from "crypto";
import { Request, RequestInfo, RequestInit, Response } from "@miniflare/core";
import { Context, MaybePromise } from "@miniflare/shared";
import { DurableObjectStorage } from "./storage";

export function hexEncode(value: Uint8Array): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const kObjectName = Symbol("kObjectName");
const kHexId = Symbol("kHexId");

export class DurableObjectId {
  readonly [kObjectName]: string;
  readonly [kHexId]: string;

  constructor(objectName: string, hexId: string, readonly name?: string) {
    this[kObjectName] = objectName;
    this[kHexId] = hexId;
  }

  equals(other: DurableObjectId): boolean {
    return this[kHexId] === other[kHexId];
  }

  toString(): string {
    return this[kHexId];
  }
}

export function objectNameFromId(id: DurableObjectId): string {
  return id[kObjectName];
}

export class DurableObjectState {
  constructor(
    readonly id: DurableObjectId,
    readonly storage: DurableObjectStorage
  ) {}

  waitUntil(_promise: Promise<void>): void {}

  blockConcurrencyWhile<T>(closure: () => Promise<T>): Promise<T> {
    // TODO: add support with input gates
    return closure();
  }
}

export interface DurableObjectConstructor {
  new (state: DurableObjectState, env: Context): DurableObject;
}

export interface DurableObject {
  fetch(request: Request): MaybePromise<Response>;
}

export class DurableObjectInternals {
  // private inputGate = new InputGate();

  constructor(
    readonly state: DurableObjectState,
    private readonly instance: DurableObject
  ) {}

  fetch(request: Request): Promise<Response> {
    // return this.inputGate.runGatedEvent(() => {
    return Promise.resolve(this.instance.fetch(request));
    // });
  }

  // TODO: input gates, blockConcurrencyWhile
}

export type DurableObjectFactory = (
  id: DurableObjectId
) => Promise<DurableObjectInternals>;

const kFactory = Symbol("kFactory");

export class DurableObjectStub {
  private readonly [kFactory]: DurableObjectFactory;

  constructor(factory: DurableObjectFactory, readonly id: DurableObjectId) {
    this[kFactory] = factory;
  }

  get name(): string | undefined {
    return this.id.name;
  }

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const internals = await this[kFactory](this.id);
    // TODO: add fake-host
    return internals.fetch(new Request(input, init));
  }
}

export interface NewUniqueIdOptions {
  jurisdiction?: "eu";
}

const HEX_ID_REGEXP = /^[A-Za-z0-9]{64}$/; // 64 hex digits

const kObjectNameHash = Symbol("kObjectNameHash");
const kObjectNameHashHex = Symbol("kObjectNameHashHex");

export class DurableObjectNamespace {
  private readonly [kObjectName]: string;
  private readonly [kFactory]: DurableObjectFactory;
  private readonly [kObjectNameHash]: Uint8Array;
  private readonly [kObjectNameHashHex]: string;

  constructor(objectName: string, factory: DurableObjectFactory) {
    this[kObjectName] = objectName;
    this[kFactory] = factory;

    // Calculate first 8 bytes of SHA-256 hash of objectName, IDs for objectName
    // must end with this
    this[kObjectNameHash] = createHash("sha256")
      .update(this[kObjectName])
      .digest()
      .slice(0, 8);
    this[kObjectNameHashHex] = hexEncode(this[kObjectNameHash]);
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
    id.set(this[kObjectNameHash], 24 /* 32 - 8 */);
    return new DurableObjectId(this[kObjectName], hexEncode(id));
  }

  idFromName(name: string): DurableObjectId {
    const id: Uint8Array = createHash("sha256")
      .update(this[kObjectName])
      .update(name)
      .digest();
    // Force first bit to be 1, ensuring no intersection with unique IDs
    id[0] |= 0b1000_0000;
    // ...then copy objectName hash
    id.set(this[kObjectNameHash], 24 /* 32 - 8 */);
    return new DurableObjectId(this[kObjectName], hexEncode(id), name);
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
    // TODO: maybe move the check anyways, this isn't where this check happens
    //  in real workers
    if (!hexId.endsWith(this[kObjectNameHashHex])) {
      throw new TypeError("ID is not for this Durable Object class.");
    }
    return new DurableObjectId(this[kObjectName], hexId.toLowerCase());
  }

  get(id: DurableObjectId): DurableObjectStub {
    if (
      id[kObjectName] !== this[kObjectName] ||
      !id[kHexId].endsWith(this[kObjectNameHashHex])
    ) {
      // TODO: check this shouldn't be "Invalid Durable Object ID. The ID does not match this Durable Object class."
      throw new TypeError("ID is not for this Durable Object class.");
    }
    return new DurableObjectStub(this[kFactory], id);
  }
}
