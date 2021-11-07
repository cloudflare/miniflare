import {
  Awaitable,
  Context,
  Log,
  MiniflareError,
  ThrowingEventTarget,
  TypedEventListener,
  ValueOf,
} from "@miniflare/shared";
import { Response as BaseResponse, fetch } from "undici";
import { DOMException } from "./domexception";
import { Request, Response, kInner, withWaitUntil } from "./http";

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
  "handlers or Durable Object constructors.";

const kResponse = Symbol("kResponse");
const kPassThrough = Symbol("kPassThrough");
const kWaitUntil = Symbol("kWaitUntil");
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

export class ExecutionContext {
  readonly #event: FetchEvent | ScheduledEvent;

  constructor(event: FetchEvent | ScheduledEvent) {
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

export const kAddModuleFetchListener = Symbol("kAddModuleFetchListener");
export const kAddModuleScheduledListener = Symbol(
  "kAddModuleScheduledListener"
);
export const kDispatchFetch = Symbol("kDispatchFetch");
export const kDispatchScheduled = Symbol("kDispatchScheduled");

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
  unhandledrejection: PromiseRejectionEvent;
  rejectionhandled: PromiseRejectionEvent;
};

export class WorkerGlobalScope extends ThrowingEventTarget<WorkerGlobalScopeEventMap> {}

export class ServiceWorkerGlobalScope extends WorkerGlobalScope {
  readonly #log: Log;
  readonly #bindings: Context;
  readonly #modules?: boolean;
  #calledAddFetchEventListener = false;

  readonly #rejectionHandledListeners = new Set<
    TypedEventListener<PromiseRejectionEvent>
  >();
  readonly #unhandledRejectionListeners = new Set<
    TypedEventListener<PromiseRejectionEvent>
  >();

  // Global self-references
  // noinspection JSUnusedGlobalSymbols
  readonly global = this;
  // noinspection JSUnusedGlobalSymbols
  readonly globalThis = this;
  // noinspection JSUnusedGlobalSymbols
  readonly self = this;

  constructor(
    log: Log,
    globals: Context,
    bindings: Context,
    modules?: boolean
  ) {
    super();
    this.#log = log;
    this.#bindings = bindings;
    this.#modules = modules;

    // Only including bindings in global scope if not using modules
    Object.assign(this, globals);
    if (modules) {
      // Error when trying to access bindings using the global in modules mode
      for (const key of Object.keys(bindings)) {
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
    if (this.#modules) {
      throw new TypeError(
        "Global addEventListener() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }

    if (type === "fetch") this.#calledAddFetchEventListener = true;

    // Register process wide unhandledRejection/rejectionHandled listeners if
    // not already done so
    if (type === "unhandledrejection" && listener) {
      if (this.#unhandledRejectionListeners.size === 0) {
        this.#log.verbose("Adding process unhandledRejection listener...");
        process.prependListener(
          "unhandledRejection",
          this.#unhandledRejectionListener
        );
      }
      this.#unhandledRejectionListeners.add(listener as any);
    }
    if (type === "rejectionhandled" && listener) {
      if (this.#rejectionHandledListeners.size === 0) {
        this.#log.verbose("Adding process rejectionHandled listener...");
        process.prependListener(
          "rejectionHandled",
          this.#rejectionHandledListener
        );
      }
      this.#rejectionHandledListeners.add(listener as any);
    }

    super.addEventListener(type, listener, options);
  };

  removeEventListener = <Type extends keyof WorkerGlobalScopeEventMap>(
    type: Type,
    listener: TypedEventListener<WorkerGlobalScopeEventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void => {
    if (this.#modules) {
      throw new TypeError(
        "Global removeEventListener() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }

    // Unregister process wide rejectionHandled/unhandledRejection listeners if
    // no longer needed and not already done so
    if (type === "unhandledrejection" && listener) {
      const registered = this.#unhandledRejectionListeners.size > 0;
      this.#unhandledRejectionListeners.delete(listener as any);
      if (registered && this.#unhandledRejectionListeners.size === 0) {
        this.#log.verbose("Removing process unhandledRejection listener...");
        process.removeListener(
          "unhandledRejection",
          this.#unhandledRejectionListener
        );
      }
    }
    if (type === "rejectionhandled" && listener) {
      const registered = this.#rejectionHandledListeners.size > 0;
      this.#rejectionHandledListeners.delete(listener as any);
      if (registered && this.#rejectionHandledListeners.size === 0) {
        this.#log.verbose("Removing process rejectionHandled listener...");
        process.removeListener(
          "rejectionHandled",
          this.#rejectionHandledListener
        );
      }
    }

    super.removeEventListener(type, listener, options);
  };

  dispatchEvent = (event: ValueOf<WorkerGlobalScopeEventMap>): boolean => {
    if (this.#modules) {
      throw new TypeError(
        "Global dispatchEvent() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }
    return super.dispatchEvent(event);
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
      const waitUntil = Promise.all(event[kWaitUntil]) as Promise<WaitUntil>;
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

    request.headers.delete("host");
    // noinspection ES6MissingAwait
    const waitUntil = Promise.all(event[kWaitUntil]) as Promise<WaitUntil>;
    return withWaitUntil(await fetch(request[kInner]), waitUntil);
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
    return (await Promise.all(event[kWaitUntil])) as WaitUntil;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  #unhandledRejectionListener = (reason: any, promise: Promise<any>): void => {
    const event = new PromiseRejectionEvent("unhandledrejection", {
      reason,
      promise,
    });
    const notCancelled = super.dispatchEvent(event);
    // If the event wasn't preventDefault()ed, remove the listener and cause
    // an unhandled promise rejection again. This should terminate the program.
    if (notCancelled) {
      process.removeListener(
        "unhandledRejection",
        this.#unhandledRejectionListener
      );
      // noinspection JSIgnoredPromiseFromCall
      Promise.reject(reason);
    }
  };

  #rejectionHandledListener = (promise: Promise<any>): void => {
    // Node.js doesn't give us the reason :(
    const event = new PromiseRejectionEvent("rejectionhandled", { promise });
    super.dispatchEvent(event);
  };

  dispose(): void {
    if (this.#unhandledRejectionListeners.size > 0) {
      this.#log.verbose("Removing process unhandledRejection listener...");
      process.removeListener(
        "unhandledRejection",
        this.#unhandledRejectionListener
      );
    }
    this.#unhandledRejectionListeners.clear();

    if (this.#rejectionHandledListeners.size > 0) {
      this.#log.verbose("Removing process rejectionHandled listener...");
      process.removeListener(
        "rejectionHandled",
        this.#rejectionHandledListener
      );
    }
    this.#rejectionHandledListeners.clear();
  }
}
