import assert from "assert";
import { AsyncLocalStorage } from "async_hooks";

// Maximum number of subrequests per request context. Cloudflare support can
// increase the limit for customers with specific needs, so it's configurable.
// This used to be via a `--subrequest-limit` flag, but it's a niche option,
// and it was a little annoying to pass the constant around everywhere.
// 0 means no subrequests are allowed. A negative value disables the limit.
// Note: `parseInt(undefined)` is `NaN`
const subrequestLimit = parseInt(process.env.MINIFLARE_SUBREQUEST_LIMIT!);
const MAX_SUBREQUESTS = isNaN(subrequestLimit) ? 50 : subrequestLimit;

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

export function assertInRequest(): void {
  if (!getRequestContext()) {
    throw new Error(
      "Some functionality, such as asynchronous I/O (fetch, Cache API, KV), " +
        "timeouts (setTimeout, setInterval), and generating random values " +
        "(crypto.getRandomValues, crypto.subtle.generateKey), can only be " +
        "performed while handling a request."
    );
  }
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
}

export class RequestContext {
  readonly requestDepth: number;
  readonly pipelineDepth: number;

  constructor({
    requestDepth = 1,
    pipelineDepth = 1,
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
    if (MAX_SUBREQUESTS >= 0 && this.#subrequests > MAX_SUBREQUESTS) {
      throw new Error(
        `Too many subrequests. Workers can make up to ${MAX_SUBREQUESTS} subrequests per request.
A subrequest is a call to fetch(), a redirect, or a call to any Cache API method.`
      );
    }
  }
}
