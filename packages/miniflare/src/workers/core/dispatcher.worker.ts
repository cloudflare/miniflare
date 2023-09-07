import { ServiceWorkerGlobalScope } from "@cloudflare/workers-types/experimental";

class Fetcher {
  #worker;
  #outbound;
  #outboundParams;

  constructor(
    worker: ServiceWorkerGlobalScope,
    outbound: ServiceWorkerGlobalScope,
    outboundParams: any
  ) {
    this.#worker = worker;
    this.#outbound = outbound;
    this.#outboundParams = outboundParams;
  }

  async fetch(request: Request): Promise<Response> {
    const response = await this.#worker.fetch(request);

    if (this.#outbound) {
      await this.#outbound.fetch(
        new Request(request, {
          method: "PUT",
          body: JSON.stringify(this.#outboundParams),
        })
      );
    }

    return response;
  }
}

interface DispatcherOptions {
  outbound?: any;
  limits?: unknown;
}

class Dispatcher {
  #env;

  constructor(env: any) {
    this.#env = env;
  }

  get(workerName: string, _args: unknown, options: DispatcherOptions) {
    const worker = this.#env[workerName];
    if (worker === undefined) {
      throw new Error("Worker not found");
    }

    if (options?.limits !== undefined) {
      console.log(
        "limits are not supported in miniflare and will not be enforced"
      );
    }

    // Find all outbound parameters
    const outbound = this.#env["mf:outbound"];
    let outboundParams = {};

    if (options?.outbound !== undefined) {
      const outboundParameterNames = JSON.parse(
        this.#env["mf:outboundParamNames"]
      );

      for (const paramName of outboundParameterNames) {
        if (options.outbound[paramName]) {
          outboundParams = {
            ...outboundParams,
            ...options.outbound[paramName],
          };
        }
      }
    }

    return new Fetcher(worker, outbound, outboundParams);
  }
}

function makeDispatcher(env: any) {
  return new Dispatcher(env);
}

export default makeDispatcher;
