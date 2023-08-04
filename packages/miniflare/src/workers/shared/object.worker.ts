import assert from "node:assert";
import { BlobStore } from "./blob.worker";
import { SharedBindings } from "./constants";
import { Router } from "./router.worker";
import {
  TransactionFactory,
  TypedSqlStorage,
  createTransactionFactory,
} from "./sql.worker";
import { Timers } from "./timers.worker";

export interface MiniflareDurableObjectEnv {
  // TODO(just a note): in-memory isn't in-memory when we're using workerd,
  //  restarted on `setOptions()`, so will always be writing to a disk, means
  //  there's a single type of blob store, one that does fetching
  [SharedBindings.SERVICE_BLOBS]: Fetcher;
}

export interface MiniflareDurableObjectCf {
  miniflare?: {
    name?: string;
    timerOp?: { name: keyof Timers; args?: unknown[] };
  };
}

export abstract class MiniflareDurableObject extends Router {
  readonly db: TypedSqlStorage;
  readonly #env: MiniflareDurableObjectEnv;
  readonly txn: TransactionFactory;
  readonly timers = new Timers();

  constructor(state: DurableObjectState, env: MiniflareDurableObjectEnv) {
    super();
    this.db = state.storage.sql as unknown as TypedSqlStorage;
    this.#env = env;
    this.txn = createTransactionFactory(state.storage);
  }

  #blob?: BlobStore;
  get blob(): BlobStore {
    // `blob` should only be accessed in a `fetch` request, which will make sure
    // `#blob` is initialised on first request
    assert(
      this.#blob !== undefined,
      "Expected `MiniflareDurableObject#fetch()` call before `blob` access"
    );
    return this.#blob;
  }

  async fetch(req: Request<unknown, MiniflareDurableObjectCf>) {
    // Allow control of fake timers by specifying operations in the `cf` object.
    const timerOp = req?.cf?.miniflare?.timerOp;
    if (timerOp !== undefined) {
      const func: unknown = this.timers[timerOp.name];
      assert(typeof func === "function");
      const result = await func.apply(this.timers, timerOp.args);
      return Response.json(result ?? null);
    }

    // Each regular request to a `MiniflareDurableObject` includes the object
    // ID's name, so we can create the `BlobStore`. Note, we could just use the
    // object's ID to namespace the blob store, but we previously did this by
    // name, so we do this to avoid a breaking change to persistence format.
    const name = req.cf?.miniflare?.name;
    assert(name !== undefined, "Expected `cf.miniflare.name`");
    this.#blob ??= new BlobStore(this.#env[SharedBindings.SERVICE_BLOBS], name);

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
