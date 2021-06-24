import crypto from "crypto";
import path from "path";
import {
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "@mrbbot/node-fetch";
import { DurableObjectStorage } from "../kv";
import { KVStorageFactory } from "../kv/helpers";
import { Log } from "../log";
import { ProcessedOptions } from "../options";
import { Context, Module } from "./module";

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

type DurableObjectFactory = (id: DurableObjectId) => Promise<DurableObject>;

export class DurableObjectId {
  constructor(private _hexId: string, public name?: string) {}

  toString(): string {
    return this._hexId;
  }
}

export class DurableObjectStub {
  constructor(
    private _factory: DurableObjectFactory,
    public id: DurableObjectId
  ) {}

  get name(): string | undefined {
    return this.id.name;
  }

  async fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const instance = await this._factory(this.id);
    return instance.fetch(new Request(input, init));
  }
}

export class DurableObjectNamespace {
  constructor(
    private _objectName: string,
    private _factory: DurableObjectFactory
  ) {}

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
      .update(this._objectName)
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
    return new DurableObjectStub(this._factory, id);
  }
}

const defaultPersistRoot = path.resolve(".mf", "do");

export class DurableObjectsModule extends Module {
  private readonly storageFactory: KVStorageFactory;
  readonly _instances = new Map<string, DurableObject>();
  private _contextPromise: Promise<void>;
  private _contextResolve?: () => void;
  private _constructors: Record<string, DurableObjectConstructor> = {};
  private _environment: Context = {};

  constructor(log: Log, persistRoot = defaultPersistRoot) {
    super(log);
    this.storageFactory = new KVStorageFactory(persistRoot);
    this._contextPromise = new Promise(
      (resolve) => (this._contextResolve = resolve)
    );
  }

  resetInstances(): void {
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
      const storage = new DurableObjectStorage(
        this.storageFactory.getStorage(key, persist)
      );
      const state = new DurableObjectState(id, storage);
      // TODO: throw more specific exception if constructor is undefined
      instance = new constructor(state, this._environment);
      this._instances.set(key, instance);

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
}
