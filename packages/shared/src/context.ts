import assert from "assert";
import { AsyncLocalStorage } from "async_hooks";

const MAX_SUBREQUESTS = 50;
const MAX_REQUEST_DEPTH = 16;
const MAX_PIPELINE_DEPTH = 32;

const depthError =
  "Subrequest depth limit exceeded. This request recursed through Workers " +
  "too many times. This can happen e.g. if you have a Worker or Durable " +
  "Object that calls other Workers or objects recursively.";

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export interface RequestContextOptions {
  /**
   * In this context, a request is the initial entry fetch to a Worker
   * (e.g. the incoming HTTP request), or fetch to a Durable Object stub.
   * The depth starts at 1, and increments for each recursive request.
   */
  requestDepth?: number;
  /**
   * The pipeline depth starts at 1, and increments for each recursive service
   * binding fetch. The requestDepth should not be incremented in this case.
   * The pipeline depth resets for each new request (as described above).
   */
  pipelineDepth?: number;
  subrequestLimit?: boolean | number;
}

export class RequestContext {
  readonly requestDepth: number;
  readonly pipelineDepth: number;
  readonly subrequestLimit: false | number;

  constructor({
    requestDepth = 1,
    pipelineDepth = 1,
    subrequestLimit,
  }: RequestContextOptions = {}) {
    assert(requestDepth >= 1);
    assert(pipelineDepth >= 1);
    if (requestDepth > MAX_REQUEST_DEPTH) {
      throw new Error(
        `${depthError}\nWorkers and objects can recurse up to ${MAX_REQUEST_DEPTH} times.\nIf you're trying to fetch from an origin server, make sure you've set the \`upstream\` option.`
      );
    }
    if (pipelineDepth > MAX_PIPELINE_DEPTH) {
      throw new Error(
        `${depthError}\nService bindings can recurse up to ${MAX_PIPELINE_DEPTH} times.`
      );
    }

    this.requestDepth = requestDepth;
    this.pipelineDepth = pipelineDepth;

    if (subrequestLimit === false || typeof subrequestLimit === "number") {
      // Use no limit or custom limit if set
      this.subrequestLimit = subrequestLimit;
    } else {
      // Otherwise, if `true` or `undefined`, default to MAX_SUBREQUESTS
      this.subrequestLimit = MAX_SUBREQUESTS;
    }
  }

  runWith<T>(closure: () => T): T {
    return requestContextStorage.run(this, closure);
  }

  #subrequests = 0;

  get subrequests(): number {
    return this.#subrequests;
  }

  incrementSubrequests(count = 1): void {
    this.#subrequests += count;
    if (
      this.subrequestLimit !== false &&
      this.#subrequests > this.subrequestLimit
    ) {
      throw new Error(
        `Too many subrequests. Workers can make up to ${MAX_SUBREQUESTS} subrequests per request.
A subrequest is a call to fetch(), a redirect, or a call to any Cache API method.`
      );
    }
  }
}
