import { AsyncLocalStorage } from "async_hooks";

const MAX_SUBREQUESTS = 50;

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export class RequestContext {
  runWith<T>(closure: () => T): T {
    return requestContextStorage.run(this, closure);
  }

  #subrequests = 0;

  get subrequests(): number {
    return this.#subrequests;
  }

  incrementSubrequests(count = 1): void {
    this.#subrequests += count;
    if (this.#subrequests > MAX_SUBREQUESTS) {
      throw new Error(
        `Too many subrequests. Workers can make up to ${MAX_SUBREQUESTS} subrequests per request.
A subrequest is a call to fetch(), a redirect, or a call to any Cache API method.`
      );
    }
  }
}
