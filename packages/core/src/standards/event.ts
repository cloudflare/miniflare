import {
  Awaitable,
  Context,
  Log,
  MessageBatch,
  MiniflareError,
  ThrowingEventTarget,
  TypedEventListener,
  prefixError,
} from "@miniflare/shared";
import { Response as BaseResponse } from "undici";
import { DOMException } from "./domexception";
import { Request, Response, fetch, withWaitUntil } from "./http";

export type FetchErrorCode =
  | "ERR_RESPONSE_TYPE" // respondWith returned non Response promise
  | "ERR_NO_UPSTREAM" // No upstream for passThroughOnException()
  | "ERR_NO_HANDLER" // No "fetch" event listener registered
  | "ERR_NO_RESPONSE"; // No "fetch" event listener called respondWith

export class FetchError extends MiniflareError<FetchErrorCode> {}

const SUGGEST_HANDLER = 'calling addEventListener("fetch", ...)';
const SUGGEST_HANDLER_MODULES =
  "exporting a default object containing a `fetch` function property";
const SUGGEST_RES =
  "calling `event.respondWith()` with a `Response` or `Promise<Response>` in your handler";
const SUGGEST_RES_MODULES = "returning a `Response` in your handler";
const SUGGEST_GLOBAL_BINDING_MODULES =
  "Attempted to access binding using global in modules." +
  "\nYou must use the 2nd `env` parameter passed to exported " +
  "handlers/Durable Object constructors, or `context.env` with " +
  "Pages Functions.";

// Like `Promise.all()`, but also handles nested changes to the promises array
export async function waitUntilAll<WaitUntil extends any[] = unknown[]>(
  promises: Promise<unknown>[]
): Promise<WaitUntil> {
  let len = 0;
  let last: WaitUntil = [] as unknown as WaitUntil;
  // When the length of the array changes, there has been a nested call to
  // `waitUntil` and we should await the promises again
  while (len !== promises.length) {
    len = promises.length;
    last = (await Promise.all(promises)) as WaitUntil;
  }
  return last;
}

const kResponse = Symbol("kResponse");
const kPassThrough = Symbol("kPassThrough");
export const kWaitUntil = Symbol("kWaitUntil");
const kSent = Symbol("kSent");

export class FetchEvent extends Event {
  readonly request: Request;
  [kResponse]?: Promise<Response | BaseResponse>;
  [kPassThrough] = false;
  readonly [kWaitUntil]: Promise<unknown>[] = [];
  [kSent] = false;

  constructor(type: "fetch", init: { request: Request }) {
    super(type);
    this.request = init.request;
  }

  respondWith(response: Awaitable<Response | BaseResponse>): void {
    if (!(this instanceof FetchEvent)) {
      throw new TypeError("Illegal invocation");
    }
    if (this[kResponse]) {
      throw new DOMException(
        "FetchEvent.respondWith() has already been called; it can only be called once.",
        "InvalidStateError"
      );
    }
    if (this[kSent]) {
      throw new DOMException(
        "Too late to call FetchEvent.respondWith(). It must be called synchronously in the event handler.",
        "InvalidStateError"
      );
    }

    this.stopImmediatePropagation();
    this[kResponse] = Promise.resolve(response);
  }

  passThroughOnException(): void {
    if (!(this instanceof FetchEvent)) {
      throw new TypeError("Illegal invocation");
    }
    this[kPassThrough] = true;
  }

  waitUntil(promise: Awaitable<any>): void {
    if (!(this instanceof FetchEvent)) {
      throw new TypeError("Illegal invocation");
    }
    this[kWaitUntil].push(Promise.resolve(promise));
  }
}

export class ScheduledEvent extends Event {
  readonly scheduledTime: number;
  readonly cron: string;
  readonly [kWaitUntil]: Promise<unknown>[] = [];

  constructor(
    type: "scheduled",
    init: { scheduledTime: number; cron: string }
  ) {
    super(type);
    this.scheduledTime = init.scheduledTime;
    this.cron = init.cron;
  }

  waitUntil(promise: Promise<any>): void {
    if (!(this instanceof ScheduledEvent)) {
      throw new TypeError("Illegal invocation");
    }
    this[kWaitUntil].push(promise);
  }
}

export class QueueEvent extends Event {
  readonly batch: MessageBatch;
  readonly [kWaitUntil]: Promise<unknown>[] = [];

  constructor(type: "queue", init: { batch: MessageBatch }) {
    super(type);
    this.batch = init.batch;
  }

  waitUntil(promise: Promise<any>): void {
    if (!(this instanceof QueueEvent)) {
      throw new TypeError("Illegal invocation");
    }
    this[kWaitUntil].push(promise);
  }
}

export class ExecutionContext {
  readonly #event: FetchEvent | ScheduledEvent | QueueEvent;

  constructor(event: FetchEvent | ScheduledEvent | QueueEvent) {
    this.#event = event;
  }

  passThroughOnException(): void {
    if (!(this instanceof ExecutionContext)) {
      throw new TypeError("Illegal invocation");
    }
    if (this.#event instanceof FetchEvent) this.#event.passThroughOnException();
  }

  waitUntil(promise: Awaitable<any>): void {
    if (!(this instanceof ExecutionContext)) {
      throw new TypeError("Illegal invocation");
    }
    this.#event.waitUntil(promise);
  }
}

export class ScheduledController {
  constructor(
    public readonly scheduledTime: number,
    public readonly cron: string
  ) {}
}

export type ModuleFetchListener = (
  request: Request,
  env: Context,
  ctx: ExecutionContext
) => Response | Promise<Response>;

export type ModuleScheduledListener = (
  controller: ScheduledController,
  env: Context,
  ctx: ExecutionContext
) => any;

export type ModuleQueueListener = (
  batch: MessageBatch,
  env: Context,
  ctx: ExecutionContext
) => any;

export const kAddModuleFetchListener = Symbol("kAddModuleFetchListener");
export const kAddModuleScheduledListener = Symbol(
  "kAddModuleScheduledListener"
);
export const kAddModuleQueueListener = Symbol("kAddModuleQueueListener");
export const kDispatchFetch = Symbol("kDispatchFetch");
export const kDispatchScheduled = Symbol("kDispatchScheduled");
export const kDispatchQueue = Symbol("kDispatchQueue");
export const kDispose = Symbol("kDispose");

export class PromiseRejectionEvent extends Event {
  readonly promise: Promise<any>;
  readonly reason?: any;

  constructor(
    type: "unhandledrejection" | "rejectionhandled",
    init: { promise: Promise<any>; reason?: any }
  ) {
    super(type, { cancelable: true });
    this.promise = init.promise;
    this.reason = init.reason;
  }
}

export type WorkerGlobalScopeEventMap = {
  fetch: FetchEvent;
  scheduled: ScheduledEvent;
  queue: QueueEvent;
  unhandledrejection: PromiseRejectionEvent;
  rejectionhandled: PromiseRejectionEvent;
};

function isSpecialEventType(type: string) {
  return (
    type === "fetch" ||
    type === "scheduled" ||
    type === "trace" ||
    type === "queue"
  );
}

export class WorkerGlobalScope extends ThrowingEventTarget<WorkerGlobalScopeEventMap> {}

// true will be added to this set if #logUnhandledRejections is true so we
// don't remove the listener on removeEventListener, and know to dispose it.
type PromiseListenerSetMember =
  | TypedEventListener<PromiseRejectionEvent>
  | boolean;

type PromiseListener =
  | {
      name: "unhandledRejection";
      set: Set<PromiseListenerSetMember>;
      listener: (reason: any, promise: Promise<any>) => void;
    }
  | {
      name: "rejectionHandled";
      set: Set<PromiseListenerSetMember>;
      listener: (promise: Promise<any>) => void;
    };

export class ServiceWorkerGlobalScope extends WorkerGlobalScope {
  readonly #log: Log;
  readonly #bindings: Context;
  readonly #modules?: boolean;
  readonly #logUnhandledRejections?: boolean;
  #calledAddFetchEventListener = false;

  readonly #unhandledRejection: PromiseListener;
  readonly #rejectionHandled: PromiseListener;

  // Global self-references
  readonly global = this;
  readonly self = this;

  constructor(
    log: Log,
    globals: Context,
    bindings: Context,
    modules?: boolean,
    logUnhandledRejections?: boolean
  ) {
    super();
    this.#log = log;
    this.#bindings = bindings;
    this.#modules = modules;
    this.#logUnhandledRejections = logUnhandledRejections;

    this.#unhandledRejection = {
      name: "unhandledRejection",
      set: new Set(),
      listener: this.#unhandledRejectionListener,
    };
    this.#rejectionHandled = {
      name: "rejectionHandled",
      set: new Set(),
      listener: this.#rejectionHandledListener,
    };
    // If we're logging unhandled rejections, register the process-wide listener
    if (this.#logUnhandledRejections) {
      this.#maybeAddPromiseListener(this.#unhandledRejection, true);
    }

    // Only including bindings in global scope if not using modules
    Object.assign(this, globals);
    if (modules) {
      // Error when trying to access bindings using the global in modules mode
      for (const key of Object.keys(bindings)) {
        // @cloudflare/kv-asset-handler checks the typeof these keys which
        // triggers an access. We want this typeof to return "undefined", not
        // throw, so skip these specific keys.
        if (key === "__STATIC_CONTENT" || key === "__STATIC_CONTENT_MANIFEST") {
          break;
        }

        Object.defineProperty(this, key, {
          get() {
            throw new ReferenceError(
              `${key} is not defined.\n${SUGGEST_GLOBAL_BINDING_MODULES}`
            );
          },
        });
      }
    } else {
      Object.assign(this, bindings);
    }
  }

  addEventListener = <Type extends keyof WorkerGlobalScopeEventMap>(
    type: Type,
    listener: TypedEventListener<WorkerGlobalScopeEventMap[Type]> | null,
    options?: AddEventListenerOptions | boolean
  ): void => {
    if (this.#modules && isSpecialEventType(type)) {
      return this.#log.warn(
        `When using module syntax, the '${type}' event handler should be declared as an exported function on the root module as opposed to using the global addEventListener().`
      );
    }

    if (type === "fetch") this.#calledAddFetchEventListener = true;

    // Register process wide unhandledRejection/rejectionHandled listeners if
    // not already done so
    if (type === "unhandledrejection" && listener) {
      this.#maybeAddPromiseListener(this.#unhandledRejection, listener);
    }
    if (type === "rejectionhandled" && listener) {
      this.#maybeAddPromiseListener(this.#rejectionHandled, listener);
    }

    super.addEventListener(type, listener, options);
  };

  removeEventListener = <Type extends keyof WorkerGlobalScopeEventMap>(
    type: Type,
    listener: TypedEventListener<WorkerGlobalScopeEventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void => {
    if (this.#modules && isSpecialEventType(type)) return;

    // Unregister process wide rejectionHandled/unhandledRejection listeners if
    // no longer needed and not already done so
    if (type === "unhandledrejection" && listener) {
      this.#maybeRemovePromiseListener(this.#unhandledRejection, listener);
    }
    if (type === "rejectionhandled" && listener) {
      this.#maybeRemovePromiseListener(this.#rejectionHandled, listener);
    }

    super.removeEventListener(type, listener, options);
  };

  [kAddModuleFetchListener](listener: ModuleFetchListener): void {
    this.#calledAddFetchEventListener = true;
    super.addEventListener("fetch", (e) => {
      const ctx = new ExecutionContext(e);
      const res = listener(e.request, this.#bindings, ctx);
      e.respondWith(res);
    });
  }

  [kAddModuleScheduledListener](listener: ModuleScheduledListener): void {
    super.addEventListener("scheduled", (e) => {
      const controller = new ScheduledController(e.scheduledTime, e.cron);
      const ctx = new ExecutionContext(e);
      const res = listener(controller, this.#bindings, ctx);
      if (res !== undefined) e.waitUntil(Promise.resolve(res));
    });
  }

  [kAddModuleQueueListener](listener: ModuleQueueListener): void {
    super.addEventListener("queue", (e) => {
      const res = listener(e.batch, this.#bindings, new ExecutionContext(e));
      if (res !== undefined) e.waitUntil(Promise.resolve(res));
    });
  }

  async [kDispatchFetch]<WaitUntil extends any[] = unknown[]>(
    request: Request,
    proxy = false
  ): Promise<Response<WaitUntil>> {
    // No need to clone request if not proxying, no chance we'll need to send
    // it somewhere else
    const event = new FetchEvent("fetch", {
      request: proxy ? request.clone() : request,
    });
    let res: Response | BaseResponse | undefined;
    try {
      super.dispatchEvent(event);
      // `event[kResponse]` may be `undefined`, but `await undefined` is still
      // `undefined`
      res = await event[kResponse];
    } catch (e: any) {
      if (event[kPassThrough]) {
        this.#log.warn(e.stack);
      } else {
        throw e;
      }
    } finally {
      event[kSent] = true;
    }
    if (res !== undefined) {
      // noinspection SuspiciousTypeOfGuard
      const validRes = res instanceof Response || res instanceof BaseResponse;
      if (!validRes) {
        const suggestion = this.#modules ? SUGGEST_RES_MODULES : SUGGEST_RES;
        throw new FetchError(
          "ERR_RESPONSE_TYPE",
          `Fetch handler didn't respond with a Response object.\nMake sure you're ${suggestion}.`
        );
      }

      // noinspection ES6MissingAwait
      const waitUntil = waitUntilAll<WaitUntil>(event[kWaitUntil]);
      return withWaitUntil(res, waitUntil);
    }

    if (!proxy) {
      if (event[kPassThrough]) {
        throw new FetchError(
          "ERR_NO_UPSTREAM",
          "No upstream to pass-through to specified.\nMake sure you've set the `upstream` option."
        );
      } else if (this.#calledAddFetchEventListener) {
        // Technically we'll get this error if we addEventListener and then
        // removeEventListener, but that seems extremely unlikely, and you
        // probably know what you're doing if you're calling removeEventListener
        // on the global
        const suggestion = this.#modules ? SUGGEST_RES_MODULES : SUGGEST_RES;
        throw new FetchError(
          "ERR_NO_RESPONSE",
          `No fetch handler responded and no upstream to proxy to specified.\nMake sure you're ${suggestion}.`
        );
      } else {
        const suggestion = this.#modules
          ? SUGGEST_HANDLER_MODULES
          : SUGGEST_HANDLER;
        throw new FetchError(
          "ERR_NO_HANDLER",
          `No fetch handler defined and no upstream to proxy to specified.\nMake sure you're ${suggestion}.`
        );
      }
    }

    // noinspection ES6MissingAwait
    const waitUntil = waitUntilAll<WaitUntil>(event[kWaitUntil]);
    return withWaitUntil(await fetch(request), waitUntil);
  }

  async [kDispatchScheduled]<WaitUntil extends any[] = any[]>(
    scheduledTime?: number,
    cron?: string
  ): Promise<WaitUntil> {
    const event = new ScheduledEvent("scheduled", {
      scheduledTime: scheduledTime ?? Date.now(),
      cron: cron ?? "",
    });
    super.dispatchEvent(event);
    return waitUntilAll<WaitUntil>(event[kWaitUntil]);
  }

  async [kDispatchQueue]<WaitUntil extends any[] = any[]>(
    batch: MessageBatch
  ): Promise<WaitUntil> {
    const event = new QueueEvent("queue", { batch });
    super.dispatchEvent(event);
    return waitUntilAll<WaitUntil>(event[kWaitUntil]);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  #maybeAddPromiseListener(listener: PromiseListener, member: any): void {
    if (listener.set.size === 0) {
      this.#log.verbose(`Adding process ${listener.name} listener...`);
      process.prependListener(listener.name as any, listener.listener as any);
    }
    listener.set.add(member);
  }
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  #maybeRemovePromiseListener(listener: PromiseListener, member: any): void {
    const registered = listener.set.size > 0;
    listener.set.delete(member);
    if (registered && listener.set.size === 0) {
      this.#log.verbose(`Removing process ${listener.name} listener...`);
      process.removeListener(listener.name, listener.listener);
    }
  }
  #resetPromiseListener(listener: PromiseListener): void {
    if (listener.set.size > 0) {
      this.#log.verbose(`Removing process ${listener.name} listener...`);
      process.removeListener(listener.name, listener.listener);
    }
    listener.set.clear();
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  #unhandledRejectionListener = (reason: any, promise: Promise<any>): void => {
    const event = new PromiseRejectionEvent("unhandledrejection", {
      reason,
      promise,
    });
    const notCancelled = super.dispatchEvent(event);
    // If the event wasn't preventDefault()ed,
    if (notCancelled) {
      if (this.#logUnhandledRejections) {
        // log if we're logging unhandled rejections
        this.#log.error(prefixError("Unhandled Promise Rejection", reason));
      } else {
        // ...otherwise, remove the listener and cause an unhandled promise
        // rejection again. This should terminate the program.
        this.#resetPromiseListener(this.#unhandledRejection);
        // noinspection JSIgnoredPromiseFromCall
        Promise.reject(reason);
      }
    }
  };

  #rejectionHandledListener = (promise: Promise<any>): void => {
    // Node.js doesn't give us the reason :(
    const event = new PromiseRejectionEvent("rejectionhandled", { promise });
    super.dispatchEvent(event);
  };

  [kDispose](): void {
    this.#resetPromiseListener(this.#unhandledRejection);
    this.#resetPromiseListener(this.#rejectionHandled);
  }
}
