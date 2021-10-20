import {
  Context,
  Log,
  MaybePromise,
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

const kResponse = Symbol("kResponse");
const kPassThrough = Symbol("kPassThrough");
const kWaitUntil = Symbol("kWaitUntil");
const kSent = Symbol("kSent");

export class FetchEvent extends Event {
  [kResponse]?: Promise<Response | BaseResponse>;
  [kPassThrough] = false;
  readonly [kWaitUntil]: Promise<unknown>[] = [];
  [kSent] = false;

  constructor(public readonly request: Request) {
    super("fetch");
  }

  respondWith(response: MaybePromise<Response | BaseResponse>): void {
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

  waitUntil(promise: MaybePromise<any>): void {
    if (!(this instanceof FetchEvent)) {
      throw new TypeError("Illegal invocation");
    }
    this[kWaitUntil].push(Promise.resolve(promise));
  }
}

export class ScheduledEvent extends Event {
  readonly [kWaitUntil]: Promise<unknown>[] = [];

  constructor(
    public readonly scheduledTime: number,
    public readonly cron: string
  ) {
    super("scheduled");
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

  waitUntil(promise: MaybePromise<any>): void {
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

export type WorkerGlobalScopeEventMap = {
  fetch: FetchEvent;
  scheduled: ScheduledEvent;
};

export class WorkerGlobalScope extends ThrowingEventTarget<WorkerGlobalScopeEventMap> {}

export class ServiceWorkerGlobalScope extends WorkerGlobalScope {
  readonly #log: Log;
  readonly #bindings: Context;
  readonly #modules?: boolean;
  #addedFetchListener = false;

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
    if (!modules) Object.assign(this, bindings);

    // Make sure this remains bound when creating VM context
    this.addEventListener = this.addEventListener.bind(this);
    this.removeEventListener = this.removeEventListener.bind(this);
    this.dispatchEvent = this.dispatchEvent.bind(this);
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
    if (type === "fetch") this.#addedFetchListener = true;
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
    this.#addedFetchListener = true;
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
      e.waitUntil(Promise.resolve(res));
    });
  }

  async [kDispatchFetch]<WaitUntil extends any[] = unknown[]>(
    request: Request,
    proxy = false
  ): Promise<Response<WaitUntil>> {
    // No need to clone request if not proxying, no chance we'll need to send
    // it somewhere else
    const event = new FetchEvent(proxy ? request.clone() : request);
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
      } else if (this.#addedFetchListener) {
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
    const event = new ScheduledEvent(scheduledTime ?? Date.now(), cron ?? "");
    super.dispatchEvent(event);
    return (await Promise.all(event[kWaitUntil])) as WaitUntil;
  }
}
