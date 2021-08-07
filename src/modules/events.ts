import { URL } from "url";
import fetch from "@mrbbot/node-fetch";
import { TypedEventListener, typedEventTarget } from "../helpers";
import { Log } from "../log";
import { Context, Module } from "./module";
import { FetchError, Request, Response } from "./standards";

// Event properties that need to be accessible in the events module but not
// to user code, exported for testing
export const responseSymbol = Symbol("response");
export const passThroughSymbol = Symbol("passThrough");
export const waitUntilSymbol = Symbol("waitUntil");

export class FetchEvent extends Event {
  [responseSymbol]?: Promise<Response>;
  [passThroughSymbol] = false;
  readonly [waitUntilSymbol]: Promise<any>[] = [];

  constructor(public readonly request: Request) {
    super("fetch");
  }

  respondWith(response: Response | Promise<Response>): void {
    this.stopImmediatePropagation();
    this[responseSymbol] = Promise.resolve(response);
  }

  passThroughOnException(): void {
    this[passThroughSymbol] = true;
  }

  waitUntil(promise: Promise<any>): void {
    this[waitUntilSymbol].push(promise);
  }
}

export class ScheduledEvent extends Event {
  readonly [waitUntilSymbol]: Promise<any>[] = [];

  constructor(
    public readonly scheduledTime: number,
    public readonly cron: string
  ) {
    super("scheduled");
  }

  waitUntil(promise: Promise<any>): void {
    this[waitUntilSymbol].push(promise);
  }
}

export type ModuleFetchListener = (
  request: Request,
  environment: Context,
  ctx: {
    passThroughOnException: () => void;
    waitUntil: (promise: Promise<any>) => void;
  }
) => Response | Promise<Response>;

export type ModuleScheduledListener = (
  controller: { scheduledTime: number; cron: string },
  environment: Context,
  ctx: { waitUntil: (promise: Promise<any>) => void }
) => any;

export type ResponseWaitUntil<WaitUntil extends any[] = any[]> = Response & {
  waitUntil: () => Promise<WaitUntil>;
};

export const addModuleFetchListenerSymbol = Symbol("addModuleFetchListener");
export const addModuleScheduledListenerSymbol = Symbol(
  "addModuleScheduledListener"
);
export const dispatchFetchSymbol = Symbol("dispatchFetch");
export const dispatchScheduledSymbol = Symbol("dispatchScheduled");

type EventMap = {
  fetch: FetchEvent;
  scheduled: ScheduledEvent;
};
export class ServiceWorkerGlobalScope extends typedEventTarget<EventMap>() {
  readonly #log: Log;
  readonly #environment: Context;
  readonly #wrappedListeners = new WeakMap<
    EventListenerOrEventListenerObject,
    EventListener
  >();
  #wrappedError?: Error;
  global: this;
  globalThis: this;
  self: this;

  constructor(
    log: Log,
    sandbox: Context,
    environment: Context,
    modules?: boolean
  ) {
    super();
    this.#log = log;
    this.#environment = environment;

    // Only including environment in global scope if not using modules
    Object.assign(this, sandbox);
    if (!modules) Object.assign(this, environment);

    // Build global self-references
    this.global = this;
    this.globalThis = this;
    this.self = this;

    // Make sure this remains bound when creating VM context
    this.addEventListener = this.addEventListener.bind(this);
    this.removeEventListener = this.removeEventListener.bind(this);
    this.dispatchEvent = this.dispatchEvent.bind(this);
  }

  #wrap(listener: TypedEventListener<Event> | null): EventListener | null {
    // When an event listener throws, we want dispatching to stop and the
    // error to be thrown so we can catch it and display a nice error page.
    // Unfortunately, Node's event target emits uncaught exceptions when a
    // listener throws, which are tricky to catch without breaking tests (AVA
    // also registers an uncaught exception handler).
    //
    // Node 16.6.0's internal implementation contains this line to throw
    // uncaught exceptions: `process.nextTick(() => { throw err; });`.
    // A potential solution would be to monkey-patch `process.nextTick` and call
    // the callback immediately:
    //
    // ```js
    // const originalNextTick = process.nextTick;
    // process.nextTick = (callback) => callback();
    // try {
    //   this.dispatchEvent(event);
    // } finally {
    //   process.nextTick = originalNextTick;
    // }
    // ```
    //
    // However, this relies on internal behaviour that may change at any point
    // and may prevent the EventTarget from doing required clean up. Hence,
    // we wrap event listeners instead, storing the wrapped versions in a
    // WeakMap so they can be removed when the original listener is passed to
    // removeEventListener.

    if (listener === null) return null;
    const wrappedListeners = this.#wrappedListeners;
    let wrappedListener = wrappedListeners.get(listener);
    if (wrappedListener) return wrappedListener;
    wrappedListener = (event) => {
      try {
        if ("handleEvent" in listener) {
          listener.handleEvent(event);
        } else {
          listener(event);
        }
      } catch (error) {
        event.stopImmediatePropagation();
        this.#wrappedError = error;
      }
    };
    wrappedListeners.set(listener, wrappedListener);
    return wrappedListener;
  }

  addEventListener<EventType extends keyof EventMap>(
    type: EventType,
    listener: TypedEventListener<EventMap[EventType]> | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    super.addEventListener(type, this.#wrap(listener as any), options);
  }

  removeEventListener<EventType extends keyof EventMap>(
    type: EventType,
    listener: TypedEventListener<EventMap[EventType]> | null,
    options?: EventListenerOptions | boolean
  ): void {
    super.removeEventListener(type, this.#wrap(listener as any), options);
  }

  dispatchEvent(event: Event): boolean {
    this.#wrappedError = undefined;
    const result = super.dispatchEvent(event);
    if (this.#wrappedError !== undefined) throw this.#wrappedError;
    return result;
  }

  [addModuleFetchListenerSymbol](listener: ModuleFetchListener): void {
    const environment = this.#environment;
    this.addEventListener("fetch", (e) => {
      const ctx = {
        passThroughOnException: e.passThroughOnException.bind(e),
        waitUntil: e.waitUntil.bind(e),
      };
      const res = listener(e.request, environment, ctx);
      e.respondWith(res);
    });
  }

  [addModuleScheduledListenerSymbol](listener: ModuleScheduledListener): void {
    const environment = this.#environment;
    this.addEventListener("scheduled", (e) => {
      const controller = { cron: e.cron, scheduledTime: e.scheduledTime };
      const ctx = { waitUntil: e.waitUntil.bind(e) };
      const res = listener(controller, environment, ctx);
      e.waitUntil(Promise.resolve(res));
    });
  }

  async [dispatchFetchSymbol]<WaitUntil extends any[] = any[]>(
    request: Request,
    upstreamUrl?: URL
  ): Promise<ResponseWaitUntil<WaitUntil>> {
    // NOTE: upstreamUrl is only used for throwing an error if no listener
    // provides a response. For this function to work correctly, the request's
    // origin must also be upstreamUrl.

    const event = new FetchEvent(request.clone());
    const waitUntil = async () => {
      return (await Promise.all(event[waitUntilSymbol])) as WaitUntil;
    };
    try {
      this.dispatchEvent(event);
      // `event[responseSymbol]` may be `undefined`, but `await undefined` is
      // still `undefined`
      const response = (await event[responseSymbol]) as
        | ResponseWaitUntil<WaitUntil>
        | undefined;
      if (response) {
        response.waitUntil = waitUntil;
        return response;
      }
    } catch (e) {
      if (event[passThroughSymbol]) {
        // warn instead of error so we don't throw an exception when not logging
        this.#log.warn(e.stack);
      } else {
        throw e;
      }
    }

    if (!upstreamUrl) {
      throw new FetchError(
        "No fetch handler responded and unable to proxy request to upstream: no upstream specified. " +
          "Have you added a fetch event listener that responds with a Response?",
        "upstream"
      );
    }

    request.headers.delete("host");
    const response = (await fetch(request)) as ResponseWaitUntil<WaitUntil>;
    response.waitUntil = waitUntil;
    return response;
  }

  async [dispatchScheduledSymbol]<WaitUntil extends any[] = any[]>(
    scheduledTime?: number,
    cron?: string
  ): Promise<WaitUntil> {
    const event = new ScheduledEvent(scheduledTime ?? Date.now(), cron ?? "");
    this.dispatchEvent(event);
    return (await Promise.all(event[waitUntilSymbol])) as WaitUntil;
  }
}

export class EventsModule extends Module {
  buildSandbox(): Context {
    return {
      Event,
      EventTarget,
      FetchEvent,
      ScheduledEvent,
    };
  }
}
