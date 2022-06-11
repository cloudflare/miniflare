import assert from "assert";
import { AsyncLocalStorage } from "async_hooks";
import { UsageModel } from "./wrangler";

// Overrides for maximum number of subrequests per request context. Cloudflare
// support can increase the limit for customers with specific needs, so it's
// configurable. This used to be via a `--subrequest-limit` flag, but it's a
// niche option. 0 means no subrequests are allowed. A negative value disables
// the limit.
function parseSubrequestOverride(limit?: string): number | false | undefined {
  // Note: `parseInt(undefined)` is `NaN`
  const parsed = parseInt(limit!);
  if (Number.isNaN(parsed)) return undefined;
  if (parsed < 0) return false;
  return parsed;
}
const EXTERNAL_SUBREQUEST_LIMIT_OVERRIDE = parseSubrequestOverride(
  process.env.MINIFLARE_SUBREQUEST_LIMIT
);
const INTERNAL_SUBREQUEST_LIMIT_OVERRIDE = parseSubrequestOverride(
  process.env.MINIFLARE_INTERNAL_SUBREQUEST_LIMIT
);

// https://developers.cloudflare.com/workers/platform/limits#subrequests
export const EXTERNAL_SUBREQUEST_LIMIT_BUNDLED = 50;
export const EXTERNAL_SUBREQUEST_LIMIT_UNBOUND = 1000;
export const INTERNAL_SUBREQUEST_LIMIT = 1000;

export function usageModelExternalSubrequestLimit(model?: UsageModel): number {
  return model === "unbound"
    ? EXTERNAL_SUBREQUEST_LIMIT_UNBOUND
    : EXTERNAL_SUBREQUEST_LIMIT_BUNDLED;
}

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
  /**
   * Whether this context is for inside a Durable Object fetch. Affects
   * WebSocket subrequest limits for incoming messages.
   */
  durableObject?: boolean;

  /** Maximum external subrequests (`fetch`, Cache API) allowed. */
  externalSubrequestLimit?: number | false;
  /** Maximum internal subrequests (KV, Durable Objects) allowed. */
  internalSubrequestLimit?: number | false;
}

export class RequestContext {
  readonly requestDepth: number;
  readonly pipelineDepth: number;
  readonly durableObject: boolean;

  readonly externalSubrequestLimit: number | false;
  readonly internalSubrequestLimit: number | false;

  #internalSubrequests = 0;
  #externalSubrequests = 0;

  constructor({
    requestDepth = 1,
    pipelineDepth = 1,
    durableObject = false,
    externalSubrequestLimit = EXTERNAL_SUBREQUEST_LIMIT_BUNDLED,
    internalSubrequestLimit = INTERNAL_SUBREQUEST_LIMIT,
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
    this.durableObject = durableObject;

    this.externalSubrequestLimit =
      EXTERNAL_SUBREQUEST_LIMIT_OVERRIDE !== undefined
        ? EXTERNAL_SUBREQUEST_LIMIT_OVERRIDE
        : externalSubrequestLimit;
    this.internalSubrequestLimit =
      INTERNAL_SUBREQUEST_LIMIT_OVERRIDE !== undefined
        ? INTERNAL_SUBREQUEST_LIMIT_OVERRIDE
        : internalSubrequestLimit;
  }

  runWith<T>(closure: () => T): T {
    return requestContextStorage.run(this, closure);
  }

  get externalSubrequests(): number {
    return this.#externalSubrequests;
  }

  get internalSubrequests(): number {
    return this.#internalSubrequests;
  }

  incrementExternalSubrequests(count = 1): void {
    this.#externalSubrequests += count;
    if (
      this.externalSubrequestLimit !== false &&
      this.#externalSubrequests > this.externalSubrequestLimit
    ) {
      throw new Error(
        `Too many subrequests. Workers can make up to ${this.externalSubrequestLimit} subrequests per request.
A subrequest is a call to fetch(), a redirect, or a call to any Cache API method.`
      );
    }
  }

  incrementInternalSubrequests(count = 1): void {
    this.#internalSubrequests += count;
    if (
      this.internalSubrequestLimit !== false &&
      this.#internalSubrequests > this.internalSubrequestLimit
    ) {
      throw new Error(
        `Too many API requests by single worker invocation. Workers can make up to ${this.internalSubrequestLimit} KV and Durable Object requests per invocation.`
      );
    }
  }
}
