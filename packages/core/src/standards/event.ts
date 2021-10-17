import {
  Context,
  Log,
  MaybePromise,
  ThrowingEventTarget,
  TypedEventListener,
  ValueOf,
} from "@miniflare/shared";
import { Response as BaseResponse, fetch } from "undici";
import { DOMException } from "./domexception";
import { Request, Response, kInner, withWaitUntil } from "./http";

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

  // TODO: check if we need to add "Illegal Invocation" errors to these methods

  respondWith(response: MaybePromise<Response | BaseResponse>): void {
    // TODO: test these errors
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
    this[kPassThrough] = true;
  }

  waitUntil(promise: Promise<any>): void {
    this[kWaitUntil].push(promise);
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

  // TODO: check if we need to add "Illegal Invocation" error to this method
  waitUntil(promise: Promise<any>): void {
    this[kWaitUntil].push(promise);
  }
}

export type ModuleFetchListener = (
  request: Request,
  env: Context,
  ctx: {
    passThroughOnException: () => void;
    waitUntil: (promise: Promise<any>) => void;
  }
) => Response | Promise<Response>;

export type ModuleScheduledListener = (
  controller: { scheduledTime: number; cron: string },
  env: Context,
  ctx: { waitUntil: (promise: Promise<any>) => void }
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
      // TODO: test this error
      throw new TypeError(
        "Global addEventListener() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }
    super.addEventListener(type, listener, options);
  };

  removeEventListener = <Type extends keyof WorkerGlobalScopeEventMap>(
    type: Type,
    listener: TypedEventListener<WorkerGlobalScopeEventMap[Type]> | null,
    options?: EventListenerOptions | boolean
  ): void => {
    if (this.#modules) {
      // TODO: test this error
      throw new TypeError(
        "Global removeEventListener() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }
    super.removeEventListener(type, listener, options);
  };

  dispatchEvent = (event: ValueOf<WorkerGlobalScopeEventMap>): boolean => {
    if (this.#modules) {
      // TODO: test this error
      throw new TypeError(
        "Global dispatchEvent() cannot be used in modules. Instead, event " +
          "handlers should be declared as exports on the root module."
      );
    }
    return super.dispatchEvent(event);
  };

  [kAddModuleFetchListener](listener: ModuleFetchListener): void {
    super.addEventListener("fetch", (e) => {
      // TODO: check if we need to add "Illegal Invocation" errors to these methods,
      //  (maybe make ctx an instance of a class?)
      const ctx = {
        passThroughOnException: e.passThroughOnException.bind(e),
        waitUntil: e.waitUntil.bind(e),
      };
      const res = listener(e.request, this.#bindings, ctx);
      e.respondWith(res);
    });
  }

  [kAddModuleScheduledListener](listener: ModuleScheduledListener): void {
    super.addEventListener("scheduled", (e) => {
      // TODO: check if we need to add "Illegal Invocation" errors to these methods,
      //  (maybe make controller and ctx instances of classes?)
      const controller = { cron: e.cron, scheduledTime: e.scheduledTime };
      const ctx = { waitUntil: e.waitUntil.bind(e) };
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
    try {
      super.dispatchEvent(event);
      // `event[kResponse]` may be `undefined`, but `await undefined` is still
      // `undefined`
      const response = await event[kResponse];
      if (response !== undefined) {
        // noinspection ES6MissingAwait
        const waitUntil = Promise.all(event[kWaitUntil]) as Promise<WaitUntil>;
        return withWaitUntil(response, waitUntil);
      }
    } catch (e: any) {
      if (event[kPassThrough]) {
        this.#log.warn(e.stack);
      } else {
        throw e;
      }
    } finally {
      event[kSent] = true;
    }

    if (!proxy) {
      // TODO: split this error up, add check for handlers, check type of returns
      throw new TypeError(
        "No fetch handler responded and no upstream to proxy to specified.\n" +
          "Have you added a fetch event listener that responds with a Response?"
      );
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
