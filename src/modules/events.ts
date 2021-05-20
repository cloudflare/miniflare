import { URL } from "url";
import fetch, { FetchError, Request, Response } from "@mrbbot/node-fetch";
import { ProcessedOptions } from "../options";
import { Module, Sandbox } from "./module";

export class FetchEvent {
  readonly type: "fetch";
  readonly request: Request;
  _response?: Promise<Response>;
  _passThrough?: boolean;
  readonly _waitUntilPromises: Promise<any>[];

  constructor(request: Request) {
    this.type = "fetch";
    this.request = request;
    this._waitUntilPromises = [];
  }

  respondWith(response: Response | Promise<Response>): void {
    this._response = Promise.resolve(response);
  }

  passThroughOnException(): void {
    this._passThrough = true;
  }

  waitUntil(promise: Promise<any>): void {
    this._waitUntilPromises.push(promise);
  }
}

export class ScheduledEvent {
  readonly type: "scheduled";
  readonly scheduledTime: number;
  readonly _waitUntilPromises: Promise<any>[];

  constructor(scheduledTime: number) {
    this.type = "scheduled";
    this.scheduledTime = scheduledTime;
    this._waitUntilPromises = [];
  }

  waitUntil(promise: Promise<any>): void {
    this._waitUntilPromises.push(promise);
  }
}

type EventListener = (event: any) => void;

export type ResponseWaitUntil<WaitUntil extends any[] = any[]> = Response & {
  waitUntil: () => Promise<WaitUntil>;
};

export class EventsModule extends Module {
  private listeners: Record<string, EventListener[]> = {};

  addEventListener(type: string, listener: EventListener): void {
    if (type !== "fetch" && type !== "scheduled") {
      this.log.warn(
        `Invalid event type: expected "fetch" | "scheduled", got "${type}"`
      );
    }
    if (!(type in this.listeners)) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListeners(): void {
    this.listeners = {};
  }

  buildSandbox(_options: ProcessedOptions): Sandbox {
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
    const event = new FetchEvent(request.clone());
    const waitUntil = async () =>
      (await Promise.all(event._waitUntilPromises)) as WaitUntil;
    for (const listener of this.listeners.fetch ?? []) {
      try {
        listener(event);
        if (event._response) {
          const response = (await event._response) as ResponseWaitUntil<WaitUntil>;
          response.waitUntil = waitUntil;
          return response;
        }
      } catch (e) {
        if (event._passThrough) {
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

    // TODO: document that upstream must be passed as the request URL for
    //  dispatchEvent to work properly
    request.headers.delete("host");
    const response = (await fetch(request)) as ResponseWaitUntil<WaitUntil>;
    response.waitUntil = waitUntil;
    return response;
  }

  async dispatchScheduled<WaitUntil extends any[] = any[]>(
    scheduledTime?: number
  ): Promise<WaitUntil> {
    const event = new ScheduledEvent(scheduledTime ?? Date.now());
    for (const listener of this.listeners.scheduled ?? []) {
      listener(event);
    }
    return (await Promise.all(event._waitUntilPromises)) as WaitUntil;
  }
}
