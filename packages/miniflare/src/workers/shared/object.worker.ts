import assert from "node:assert";
import { BlobStore } from "./blob.worker";
import { LogLevel, SharedBindings, SharedHeaders } from "./constants";
import { Router } from "./router.worker";
import {
  TransactionFactory,
  TypedSqlStorage,
  all,
  createTransactionFactory,
  isTypedValue,
} from "./sql.worker";
import { Timers } from "./timers.worker";

export interface MiniflareDurableObjectEnv {
  // TODO(just a note): in-memory isn't in-memory when we're using workerd,
  //  restarted on `setOptions()`, so will always be writing to a disk, means
  //  there's a single type of blob store, one that does fetching
  [SharedBindings.MAYBE_SERVICE_BLOBS]?: Fetcher;
  // TODO: add note as to why this is optional, want simulators to be able to
  //  run standalone
  [SharedBindings.MAYBE_SERVICE_LOOPBACK]?: Fetcher;
}

export interface MiniflareDurableObjectCfControlOp {
  name: string;
  args?: unknown[];
}

export interface MiniflareDurableObjectCf {
  miniflare?: {
    name?: string;
    controlOp?: MiniflareDurableObjectCfControlOp;
  };
}

export abstract class MiniflareDurableObject<
  Env extends MiniflareDurableObjectEnv = MiniflareDurableObjectEnv
> extends Router {
  readonly timers = new Timers();
  // If this Durable Object receives a control op, assume it's being tested.
  beingTested = false;

  constructor(readonly state: DurableObjectState, readonly env: Env) {
    super();
  }

  get db(): TypedSqlStorage {
    return this.state.storage.sql as unknown as TypedSqlStorage;
  }

  #txn?: TransactionFactory;
  get txn(): TransactionFactory {
    return (this.#txn ??= createTransactionFactory(this.state.storage));
  }

  #name?: string;
  get name(): string {
    // `name` should only be accessed in a `fetch` request, which will make sure
    // `#name` is initialised on first request
    assert(
      this.#name !== undefined,
      "Expected `MiniflareDurableObject#fetch()` call before `name` access"
    );
    return this.#name;
  }

  #blob?: BlobStore;
  get blob(): BlobStore {
    if (this.#blob !== undefined) return this.#blob;
    const maybeBlobsService = this.env[SharedBindings.MAYBE_SERVICE_BLOBS];
    assert(
      maybeBlobsService !== undefined,
      `Expected ${SharedBindings.MAYBE_SERVICE_BLOBS} service binding`
    );
    this.#blob = new BlobStore(maybeBlobsService, this.name);
    return this.#blob;
  }

  logWithLevel(level: LogLevel, message: string) {
    // `timers.queueMicrotask()` allows us to wait for logs in tests
    this.timers.queueMicrotask(() =>
      this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK]?.fetch(
        "http://localhost/core/log",
        {
          method: "POST",
          headers: { [SharedHeaders.LOG_LEVEL]: level.toString() },
          body: message,
        }
      )
    );
  }

  async #handleControlOp({
    name,
    args,
  }: MiniflareDurableObjectCfControlOp): Promise<Response> {
    this.beingTested = true;
    if (name === "sqlQuery") {
      assert(args !== undefined);
      const [query, ...params] = args;
      assert(typeof query === "string");
      assert(params.every(isTypedValue));
      const results = all(this.db.prepare(query)(...params));
      return Response.json(results);
    } else if (name === "getBlob") {
      assert(args !== undefined);
      const [id] = args;
      assert(typeof id === "string");
      const stream = await this.blob.get(id);
      return new Response(stream, { status: stream === null ? 404 : 200 });
    } else {
      const func: unknown = this.timers[name as keyof Timers];
      assert(typeof func === "function");
      const result = await func.apply(this.timers, args);
      return Response.json(result ?? null);
    }
  }

  async fetch(req: Request<unknown, MiniflareDurableObjectCf>) {
    // Allow control of object internals by specifying operations in the `cf`
    // object. Used by tests to update fake time, and access internal storage.
    const controlOp = req?.cf?.miniflare?.controlOp;
    if (controlOp !== undefined) return this.#handleControlOp(controlOp);

    // Each regular request to a `MiniflareDurableObject` includes the object
    // ID's name, so we can create the `BlobStore`. Note, we could just use the
    // object's ID to namespace the blob store, but we previously did this by
    // name, so we do this to avoid a breaking change to persistence format.
    const name = req.cf?.miniflare?.name;
    assert(name !== undefined, "Expected `cf.miniflare.name`");
    this.#name = name;

    const res = await super.fetch(req);
    // Make sure we consume the request body if specified. Otherwise, calls
    // which make requests to this object may hang and never resolve.
    // TODO(now): this is probably a bug too, reproduction case is
    //  `get: returns null for expired keys` which this commented out,
    //  and replacing expirationTtl with `1`, it's the error that causes the failure I think
    if (req.body !== null && !req.bodyUsed) {
      await req.body.pipeTo(new WritableStream());
    }
    return res;
  }
}
