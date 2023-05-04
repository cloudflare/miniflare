import type {
  BodyInit,
  DurableObject,
  DurableObjectId,
  DurableObjectState,
  DurableObjectStorage,
  ExecutionContext,
  FetchEvent,
  Headers,
  ScheduledEvent,
} from "@cloudflare/workers-types/experimental";

declare global {
  /**
   * Get object containing all bindings (e.g. KV namespaces, R2 buckets).
   * This is the `env` parameter passed to module workers.
   */
  function getMiniflareBindings<Bindings = Record<string, any>>(): Bindings;
  /**
   * Get the underlying Durable Object storage for the specified ID.
   * This is the `storage` property on the `state` parameter passed to the
   * object constructor.
   */
  function getMiniflareDurableObjectStorage(
    id: DurableObjectId
  ): Promise<DurableObjectStorage>;
  /**
   * Get the Durable Object state for the specified ID.
   * This is the `state` parameter passed to the object constructor.
   */
  function getMiniflareDurableObjectState(
    id: DurableObjectId
  ): Promise<DurableObjectState>;
  /**
   * Gets the singleton Durable Object instance for the specified ID.
   * This is the same instance requests will be sent to via stubs obtained from
   * Durable Object namespace bindings.
   */
  function getMiniflareDurableObjectInstance<T extends DurableObject>(
    id: DurableObjectId
  ): Promise<T>;
  /**
   * Waits for the Durable Object's associated input gate to open, closes the
   * input gate, runs the closure under a new output gate, opens the input gate,
   * then waits for the output gate to open. If you're calling `fetch` directly
   * on a Durable Object instance, make sure to wrap the call with this to
   * prevent race conditions.
   */
  function runWithMiniflareDurableObjectGates<T>(
    state: DurableObjectState,
    closure: () => T | Promise<T>
  ): Promise<T>;
  /**
   * Gets the preconfigured `MockAgent` attached to Miniflare's `fetch`
   * function. Use this to mock responses to `fetch` requests.
   */
  function getMiniflareFetchMock(): MockAgent;
  /**
   * Waits for all `waitUntil`ed `Promise`s on the specified event or context
   * to resolve, returning a `Promise` that resolves to an array of the values
   * they resolve with.
   */
  function getMiniflareWaitUntil<WaitUntil extends any[] = unknown[]>(
    event: FetchEvent | ScheduledEvent | ExecutionContext
  ): Promise<WaitUntil>;
  /**
   * Immediately invokes scheduled Durable Object alarms. If an array of IDs is
   * specified, only those Durable Objects will have their scheduled alarms
   * invoked, otherwise all scheduled alarms will be invoked.
   */
  function flushMiniflareDurableObjectAlarms(
    ids?: DurableObjectId[]
  ): Promise<void>;
  /**
   * Gets an array containing IDs for all Durable Object instances Miniflare
   * has constructed for the specified namespace.
   */
  function getMiniflareDurableObjectIds(
    namespace: string
  ): Promise<DurableObjectId[]>;

  // eslint-disable-next-line no-var
  var ExecutionContext: {
    prototype: ExecutionContext;
    new (): ExecutionContext;
  };
}

// Taken from `undici` (https://github.com/nodejs/undici/tree/main/types) with
// no dependency on `@types/node` and with unusable functions removed
//
// MIT License
//
// Copyright (c) Matteo Collina and Undici contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

type IncomingHttpHeaders = Record<string, string | string[] | undefined>;

/** The scope associated with a mock dispatch. */
declare abstract class MockScope<TData extends object = object> {
  /** Delay a reply by a set amount of time in ms. */
  delay(waitInMs: number): MockScope<TData>;
  /** Persist the defined mock data for the associated reply. It will return the defined mock data indefinitely. */
  persist(): MockScope<TData>;
  /** Define a reply for a set amount of matching requests. */
  times(repeatTimes: number): MockScope<TData>;
}

/** The interceptor for a Mock. */
declare abstract class MockInterceptor {
  /** Mock an undici request with the defined reply. */
  reply<TData extends object = object>(
    replyOptionsCallback: MockInterceptor.MockReplyOptionsCallback<TData>
  ): MockScope<TData>;
  reply<TData extends object = object>(
    statusCode: number,
    data?:
      | TData
      | Buffer
      | string
      | MockInterceptor.MockResponseDataHandler<TData>,
    responseOptions?: MockInterceptor.MockResponseOptions
  ): MockScope<TData>;
  /** Mock an undici request by throwing the defined reply error. */
  replyWithError<TError extends Error = Error>(error: TError): MockScope;
  /** Set default reply headers on the interceptor for subsequent mocked replies. */
  defaultReplyHeaders(headers: IncomingHttpHeaders): MockInterceptor;
  /** Set default reply trailers on the interceptor for subsequent mocked replies. */
  defaultReplyTrailers(trailers: Record<string, string>): MockInterceptor;
  /** Set automatically calculated content-length header on subsequent mocked replies. */
  replyContentLength(): MockInterceptor;
}
declare namespace MockInterceptor {
  /** MockInterceptor options. */
  export interface Options {
    /** Path to intercept on. */
    path: string | RegExp | ((path: string) => boolean);
    /** Method to intercept on. Defaults to GET. */
    method?: string | RegExp | ((method: string) => boolean);
    /** Body to intercept on. */
    body?: string | RegExp | ((body: string) => boolean);
    /** Headers to intercept on. */
    headers?:
      | Record<string, string | RegExp | ((body: string) => boolean)>
      | ((headers: Record<string, string>) => boolean);
    /** Query params to intercept on */
    query?: Record<string, any>;
  }
  export interface MockDispatch<
    TData extends object = object,
    TError extends Error = Error
  > extends Options {
    times: number | null;
    persist: boolean;
    consumed: boolean;
    data: MockDispatchData<TData, TError>;
  }
  export interface MockDispatchData<
    TData extends object = object,
    TError extends Error = Error
  > extends MockResponseOptions {
    error: TError | null;
    statusCode?: number;
    data?: TData | string;
  }
  export interface MockResponseOptions {
    headers?: IncomingHttpHeaders;
    trailers?: Record<string, string>;
  }
  export interface MockResponseCallbackOptions {
    path: string;
    origin: string;
    method: string;
    body?: BodyInit;
    headers: Headers | Record<string, string>;
    maxRedirections: number;
  }
  export type MockResponseDataHandler<TData extends object = object> = (
    opts: MockResponseCallbackOptions
  ) => TData | Buffer | string;
  export type MockReplyOptionsCallback<TData extends object = object> = (
    opts: MockResponseCallbackOptions
  ) => {
    statusCode: number;
    data?: TData | Buffer | string;
    responseOptions?: MockResponseOptions;
  };
}

interface Interceptable {
  /** Intercepts any matching requests that use the same origin as this mock client. */
  intercept(options: MockInterceptor.Options): MockInterceptor;
}

interface PendingInterceptor extends MockInterceptor.MockDispatch {
  origin: string;
}
interface PendingInterceptorsFormatter {
  format(pendingInterceptors: readonly PendingInterceptor[]): string;
}

/** A mocked Agent class that implements the Agent API. It allows one to intercept HTTP requests made through undici and return mocked responses instead. */
declare abstract class MockAgent {
  /** Creates and retrieves mock Dispatcher instances which can then be used to intercept HTTP requests. If the number of connections on the mock agent is set to 1, a MockClient instance is returned. Otherwise a MockPool instance is returned. */
  get(origin: string | RegExp | ((origin: string) => boolean)): Interceptable;

  /** Disables mocking in MockAgent. */
  deactivate(): void;
  /** Enables mocking in a MockAgent instance. When instantiated, a MockAgent is automatically activated. Therefore, this method is only effective after MockAgent.deactivate has been called. */
  activate(): void;

  /** Define host matchers so only matching requests that aren't intercepted by the mock dispatchers will be attempted. */
  enableNetConnect(host?: string | RegExp | ((host: string) => boolean)): void;
  /** Causes all requests to throw when requests are not matched in a MockAgent intercept. */
  disableNetConnect(): void;

  pendingInterceptors(): PendingInterceptor[];
  assertNoPendingInterceptors(options?: {
    pendingInterceptorsFormatter?: PendingInterceptorsFormatter;
  }): void;
}
