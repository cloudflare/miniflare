import assert from "assert";
import crypto from "crypto";
import path from "path";
import { RequestInfo, RequestInit } from "@mrbbot/node-fetch";
import { MiniflareError } from "../helpers";
import { DurableObjectStorage } from "../kv";
import { abortAllSymbol } from "../kv/do";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";
import { Request, Response } from "./standards";

// Ideally we would store the storage on the DurableObject instance itself,
// but we don't know what the user's Durable Object code does, so we store it
// in a WeakMap instead. This means DurableObjectStorage instances can still be
// garbage collected if the corresponding DurableObject instance is.
const instancesStorage = new WeakMap<DurableObject, DurableObjectStorage>();

export class DurableObjectState {
  constructor(
    public id: DurableObjectId,
    public storage: DurableObjectStorage
  ) {}

  waitUntil(_promise: Promise<any>): void {}
}

export interface DurableObjectConstructor {
  new (state: DurableObjectState, environment: Context): DurableObject;
}

export interface DurableObject {
  fetch(request: Request): Response | Promise<Response>;
}

export type DurableObjectFactory = (
  id: DurableObjectId
) => Promise<DurableObject>;

export class DurableObjectId {
  readonly #hexId: string;

  constructor(hexId: string, public name?: string) {
    this.#hexId = hexId;
  }

  toString(): string {
    return this.#hexId;
  }
}

export class DurableObjectStub {
  readonly #factory: DurableObjectFactory;

  constructor(factory: DurableObjectFactory, public id: DurableObjectId) {
    this.#factory = factory;
  }

  get name(): string | undefined {
    return this.id.name;
  }

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const instance = await this.#factory(this.id);
    return instance.fetch(new Request(input, init));
  }

  // Extra Miniflare-only API exposed for easier testing
  async storage(): Promise<DurableObjectStorage> {
    const instance = await this.#factory(this.id);
    const storage = instancesStorage.get(instance);
    // #factory will make sure instance's storage is in instancesStorage
    assert(storage);
    return storage;
  }
}

export class DurableObjectNamespace {
  readonly #objectName: string;
  readonly #factory: DurableObjectFactory;

  constructor(objectName: string, factory: DurableObjectFactory) {
    this.#objectName = objectName;
    this.#factory = factory;
  }

  newUniqueId(): DurableObjectId {
    // Create new zero-filled 32 byte buffer
    const id = Buffer.alloc(32);
    // Leave first byte as 0, ensuring no intersection with named IDs
    // ...then write current time in 8 bytes
    id.writeBigUInt64BE(BigInt(Date.now()), 1);
    // ...then fill remaining 23 (32 - 8 - 1) bytes with random data
    crypto.randomFillSync(id, 9, 23);
    return new DurableObjectId(id.toString("hex"));
  }

  idFromName(name: string): DurableObjectId {
    const id = crypto
      .createHash("sha256")
      .update(this.#objectName)
      .update(name)
      .digest();
    // Force first bit to be 1, ensuring no intersection with unique IDs
    id[0] |= 0b1000_0000;
    return new DurableObjectId(id.toString("hex"), name);
  }

  idFromString(hexId: string): DurableObjectId {
    return new DurableObjectId(hexId);
  }

  get(id: DurableObjectId): DurableObjectStub {
    return new DurableObjectStub(this.#factory, id);
  }
}

const defaultPersistRoot = path.resolve(".mf", "do");

export class DurableObjectsModule extends Module {
  readonly _instances = new Map<string, DurableObject>();
  private _contextPromise: Promise<void>;
  private _contextResolve?: () => void;
  private _constructors: Record<string, DurableObjectConstructor> = {};
  private _environment: Context = {};

  constructor(
    log: Log,
    private storageFactory = new KVStorageFactory(defaultPersistRoot)
  ) {
    super(log);
    this._contextPromise = new Promise(
      (resolve) => (this._contextResolve = resolve)
    );
  }

  resetInstances(): void {
    // Abort all instance storage transactions and delete instances
    for (const instance of this._instances.values()) {
      const storage = instancesStorage.get(instance);
      assert(storage);
      storage[abortAllSymbol]();
    }
    this._instances.clear();

    this._contextPromise = new Promise(
      (resolve) => (this._contextResolve = resolve)
    );
  }

  setContext(
    constructors: Record<string, DurableObjectConstructor>,
    environment: Context
  ): void {
    this._constructors = constructors;
    this._environment = environment;
    this._contextResolve?.();
  }

  getNamespace(
    objectName: string,
    persist?: boolean | string
  ): DurableObjectNamespace {
    const factory: DurableObjectFactory = async (id) => {
      // Wait for constructors and environment
      await this._contextPromise;

      // Reuse existing instances
      const key = `${objectName}_${id.toString()}`;
      let instance = this._instances.get(key);
      if (instance) return instance;

      // Create and store new instance if none found
      const constructor = this._constructors[objectName];
      if (constructor === undefined) {
        throw new MiniflareError(
          `Missing constructor for Durable Object ${objectName}`
        );
      }
      const storage = new DurableObjectStorage(
        this.storageFactory.getStorage(key, persist)
      );
      const state = new DurableObjectState(id, storage);
      instance = new constructor(state, this._environment);
      this._instances.set(key, instance);
      instancesStorage.set(instance, storage);

      return instance;
    };
    return new DurableObjectNamespace(objectName, factory);
  }

  buildEnvironment(options: ProcessedOptions): Context {
    const environment: Context = {};
    for (const object of options.processedDurableObjects ?? []) {
      environment[object.name] = this.getNamespace(
        object.name,
        options.durableObjectsPersist
      );
    }
    return environment;
  }

  dispose(): void {
    this.storageFactory.dispose();
  }
}
