import assert from "assert";
import { URL } from "url";
import fetch, { FetchError, Request, Response } from "@mrbbot/node-fetch";
import { Context, EventListener, Module } from "./module";

// Event properties that need to be accessible in the events module but not
// to user code, exported for testing
export const responseMap = new WeakMap<FetchEvent, Promise<Response>>();
export const passThroughMap = new WeakMap<FetchEvent, boolean>();
export const waitUntilMap = new WeakMap<
  FetchEvent | ScheduledEvent,
  Promise<any>[]
>();

export class FetchEvent {
  readonly type: "fetch";
  readonly request: Request;

  constructor(request: Request) {
    this.type = "fetch";
    this.request = request;
    waitUntilMap.set(this, []);
  }

  respondWith(response: Response | Promise<Response>): void {
    responseMap.set(this, Promise.resolve(response));
  }

  passThroughOnException(): void {
    passThroughMap.set(this, true);
  }

  waitUntil(promise: Promise<any>): void {
    waitUntilMap.get(this)?.push(promise);
  }
}

export class ScheduledEvent {
  readonly type: "scheduled";
  readonly scheduledTime: number;

  constructor(scheduledTime: number) {
    this.type = "scheduled";
    this.scheduledTime = scheduledTime;
    waitUntilMap.set(this, []);
  }

  waitUntil(promise: Promise<any>): void {
    waitUntilMap.get(this)?.push(promise);
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
  controller: { scheduledTime: number },
  environment: Context,
  ctx: { waitUntil: (promise: Promise<any>) => void }
) => any;

export type ResponseWaitUntil<WaitUntil extends any[] = any[]> = Response & {
  waitUntil: () => Promise<WaitUntil>;
};

export class EventsModule extends Module {
  _listeners: Record<string, EventListener<any>[]> = {};

  addEventListener(type: "fetch", listener: EventListener<FetchEvent>): void;
  addEventListener(
    type: "scheduled",
    listener: EventListener<ScheduledEvent>
  ): void;
  addEventListener(type: string, listener: EventListener<any>): void {
    if (type !== "fetch" && type !== "scheduled") {
      this.log.warn(
        `Invalid event type: expected "fetch" | "scheduled", got "${type}"`
      );
    }
    if (!(type in this._listeners)) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  addModuleFetchListener(
    listener: ModuleFetchListener,
    environment: Context
  ): void {
    this.addEventListener("fetch", (e) => {
      const ctx = {
        passThroughOnException: e.passThroughOnException.bind(e),
        waitUntil: e.waitUntil.bind(e),
      };
      const res = listener(e.request, environment, ctx);
      e.respondWith(res);
    });
  }

  addModuleScheduledListener(
    listener: ModuleScheduledListener,
    environment: Context
  ): void {
    this.addEventListener("scheduled", (e) => {
      const controller = { scheduledTime: e.scheduledTime };
      const ctx = { waitUntil: e.waitUntil.bind(e) };
      const res = listener(controller, environment, ctx);
      e.waitUntil(Promise.resolve(res));
    });
  }

  resetEventListeners(): void {
    this._listeners = {};
  }

  buildSandbox(): Context {
    return {
      FetchEvent,
      ScheduledEvent,
      addEventListener: this.addEventListener.bind(this),
    };
  }

  async dispatchFetch<WaitUntil extends any[] = any[]>(
    request: Request,
    upstreamUrl?: URL
  ): Promise<ResponseWaitUntil<WaitUntil>> {
    // NOTE: upstreamUrl is only used for throwing an error if no listener
    // provides a response. For this function to work correctly, the request's
    // origin must also be upstreamUrl.

    const event = new FetchEvent(request.clone());
    const waitUntil = async () => {
      const waitUntilPromises = waitUntilMap.get(event);
      assert(waitUntilPromises);
      return (await Promise.all(waitUntilPromises)) as WaitUntil;
    };
    for (const listener of this._listeners.fetch ?? []) {
      try {
        listener(event);
        const responsePromise = responseMap.get(event);
        if (responsePromise) {
          const response = (await responsePromise) as ResponseWaitUntil<WaitUntil>;
          response.waitUntil = waitUntil;
          return response;
        }
      } catch (e) {
        if (passThroughMap.get(event)) {
          this.log.error(e.stack);
          break;
        }
        throw e;
      }
    }

    if (!upstreamUrl) {
      throw new FetchError(
        "Unable to proxy request to upstream: no upstream specified",
        "upstream"
      );
    }

    request.headers.delete("host");
    const response = (await fetch(request)) as ResponseWaitUntil<WaitUntil>;
    response.waitUntil = waitUntil;
    return response;
  }

  async dispatchScheduled<WaitUntil extends any[] = any[]>(
    scheduledTime?: number
  ): Promise<WaitUntil> {
    const event = new ScheduledEvent(scheduledTime ?? Date.now());
    for (const listener of this._listeners.scheduled ?? []) {
      listener(event);
    }
    const waitUntilPromises = waitUntilMap.get(event);
    assert(waitUntilPromises);
    return (await Promise.all(waitUntilPromises)) as WaitUntil;
  }
}
