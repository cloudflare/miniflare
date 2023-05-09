import type {
  ExecutionContext,
  ServiceWorkerGlobalScope,
  Request as WorkerRequest,
  Response as WorkerResponse,
} from "@cloudflare/workers-types/experimental";
import { Awaitable, Miniflare, MiniflareOptions, Timers } from "@miniflare/tre";
import anyTest, { TestFn } from "ava";
import { getPort } from "./http";
import { TestLog } from "./log";

export type TestMiniflareHandler<Env> = (
  global: ServiceWorkerGlobalScope,
  request: WorkerRequest,
  env: Env,
  ctx: ExecutionContext
) => Awaitable<WorkerResponse>;

export class TestTimers implements Timers {
  timestamp = 1_000_000; // 1000s
  #pendingMicrotasks = new Set<Promise<unknown>>();

  now = () => {
    return this.timestamp;
  };

  queueMicrotask(closure: () => Awaitable<unknown>) {
    const result = closure();
    if (result instanceof Promise) {
      this.#pendingMicrotasks.add(result);
      result.then(() => this.#pendingMicrotasks.delete(result));
    }
  }

  async waitForMicrotasks() {
    await Promise.all(this.#pendingMicrotasks);
  }
}

export interface MiniflareTestContext {
  mf: Miniflare;
  url: URL;

  // Warning: if mutating or calling any of the following, `test.serial` must be
  // used to prevent races.
  log: TestLog;
  timers: TestTimers;
  setOptions(opts: Partial<MiniflareOptions>): Promise<void>;
}

export function miniflareTest<
  Env,
  Context extends MiniflareTestContext = MiniflareTestContext
>(
  userOpts: Partial<MiniflareOptions>,
  handler?: TestMiniflareHandler<Env>
): TestFn<Context> {
  let scriptOpts: MiniflareOptions | undefined;
  if (handler !== undefined) {
    const script = `
      const handler = (${handler.toString()});
      function reduceError(e) {
        return {
          name: e?.name,
          message: e?.message ?? String(e),
          stack: e?.stack,
          cause: e?.cause === undefined ? undefined : reduceError(e.cause),
        };
      }
      export default {
        async fetch(request, env, ctx) {
          try {
            return await handler(globalThis, request, env, ctx);
          } catch (e) {
            const error = reduceError(e);
            return Response.json(error, {
              status: 500,
              headers: { "MF-Experimental-Error-Stack": "true" },
            });
          } 
        }
      }
    `;
    scriptOpts = {
      modules: [{ type: "ESModule", path: "index.mjs", contents: script }],
    };
  }

  const test = anyTest as TestFn<Context>;
  test.before(async (t) => {
    const log = new TestLog(t);
    const timers = new TestTimers();

    const opts: Partial<MiniflareOptions> = {
      ...scriptOpts,
      port: await getPort(),
      log,
      timers,
      verbose: true,
    };

    // `as MiniflareOptions` required as we're not enforcing that a script is
    // provided between `userOpts` and `opts`. We assume if it's not in
    // `userOpts`, a `handler` has been provided.
    t.context.mf = new Miniflare({ ...userOpts, ...opts } as MiniflareOptions);
    t.context.log = log;
    t.context.timers = timers;
    t.context.setOptions = (userOpts) =>
      t.context.mf.setOptions({ ...userOpts, ...opts } as MiniflareOptions);
    t.context.url = await t.context.mf.ready;
  });
  test.after((t) => t.context.mf.dispose());
  return test;
}
