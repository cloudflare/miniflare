import { FetchError } from "@mrbbot/node-fetch";
import anyTest, { TestInterface } from "ava";
import {
  FetchEvent,
  Miniflare,
  Request,
  Response,
  ScheduledEvent,
} from "../../src";
import { EventsModule } from "../../src/modules/events";
import { TestLog, noop, runInWorker, useServer } from "../helpers";

interface Context {
  log: TestLog;
  module: EventsModule;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const log = new TestLog();
  const module = new EventsModule(log);
  t.context = { log, module };
});

test("addEventListener: adds event listeners", (t) => {
  const { log, module } = t.context;
  const calls: string[] = [];
  module.addEventListener("fetch", (e) =>
    calls.push(`fetch1:${e.request.url}`)
  );
  module.addEventListener("fetch", (e) =>
    calls.push(`fetch2:${e.request.url}`)
  );
  module.addEventListener("scheduled", (e) =>
    calls.push(`scheduled1:${e.scheduledTime}`)
  );
  module.addEventListener("scheduled", (e) =>
    calls.push(`scheduled2:${e.scheduledTime}`)
  );
  t.is(log.warns.length, 0);
  module._listeners.fetch.forEach((listener) =>
    listener(new FetchEvent(new Request("http://localhost:8787/")))
  );
  module._listeners.scheduled.forEach((listener) =>
    listener(new ScheduledEvent(1000))
  );
  t.deepEqual(calls, [
    "fetch1:http://localhost:8787/",
    "fetch2:http://localhost:8787/",
    "scheduled1:1000",
    "scheduled2:1000",
  ]);
});

test("addEventListener: warns on invalid event type", (t) => {
  const { log, module } = t.context;
  const calls: string[] = [];
  // @ts-expect-error event type "random" shouldn't be allowed
  module.addEventListener("random", () => calls.push("random"));
  t.is(
    log.warns[0],
    'Invalid event type: expected "fetch" | "scheduled", got "random"'
  );
  module._listeners.random.forEach((listener) => listener(null));
  t.deepEqual(calls, ["random"]);
});

test("addModuleFunctionListener: adds event listener", async (t) => {
  const { module } = t.context;
  module.addModuleFetchListener(
    (request, env, ctx) => {
      ctx.passThroughOnException();
      ctx.waitUntil(Promise.resolve(env.KEY));
      return new Response(request.url);
    },
    { KEY: "value" }
  );
  const event = new FetchEvent(new Request("http://localhost:8787/"));
  module._listeners.fetch[0](event);
  t.true(event._passThrough);
  t.deepEqual(await Promise.all(event._waitUntilPromises), ["value"]);
  t.is(await (await event._response)?.text(), "http://localhost:8787/");
});

test("addModuleScheduledListener: adds event listener", async (t) => {
  const { module } = t.context;
  module.addModuleScheduledListener(
    (controller, env, ctx) => {
      ctx.waitUntil(Promise.resolve(env.KEY));
      return controller.scheduledTime;
    },
    { KEY: "value" }
  );
  const event = new ScheduledEvent(1000);
  module._listeners.scheduled[0](event);
  t.deepEqual(await Promise.all(event._waitUntilPromises), ["value", 1000]);
});

test("resetEventListeners: resets events listeners", (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", noop);
  t.deepEqual(module._listeners, { fetch: [noop] });
  module.resetEventListeners();
  t.deepEqual(module._listeners, {});
});

test("buildSandbox: includes event classes", async (t) => {
  const includes = await runInWorker({}, async () => {
    const sandbox = self as any;
    return "FetchEvent" in sandbox && "ScheduledEvent" in sandbox;
  });
  t.true(includes);
});

test("buildSandbox: adds fetch event listener", async (t) => {
  const script = `(${(() => {
    const sandbox = self as any;
    sandbox.addEventListener("fetch", (e: FetchEvent) =>
      e.respondWith(new sandbox.Response(e.request.url))
    );
  }).toString()})()`;
  const mf = new Miniflare({ script });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
});

test("buildSandbox: adds scheduled event listener", async (t) => {
  const script = `(${(() => {
    const sandbox = self as any;
    sandbox.addEventListener("scheduled", (e: ScheduledEvent) =>
      e.waitUntil(Promise.resolve(e.scheduledTime))
    );
  }).toString()})()`;
  const mf = new Miniflare({ script });
  const res = await mf.dispatchScheduled(1000);
  t.is(res[0], 1000);
});

test("dispatchFetch: dispatches event", async (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.respondWith(new Response(e.request.url));
  });
  const res = await module.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
});

test("dispatchFetch: dispatches event with promise response", async (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.respondWith(Promise.resolve(new Response(e.request.url)));
  });
  const res = await module.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
});

test("dispatchFetch: stops calling listeners after first response", async (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.waitUntil(Promise.resolve(2));
  });
  module.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(3));
    e.respondWith(new Response(e.request.url));
  });
  module.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(4));
  });
  const res = await module.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
  t.deepEqual(await res.waitUntil(), [1, 2, 3]);
});

test("dispatchFetch: passes through to upstream on no response", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
  });
  const res = await module.dispatchFetch(new Request(upstream), upstream);
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});

test("dispatchFetch: passes through to upstream on error", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  const res = await module.dispatchFetch(new Request(upstream), upstream);
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});

test("dispatchFetch: throws error if no pass through on listener error", async (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () => module.dispatchFetch(new Request("http://localhost:8787/")),
    { instanceOf: Error, message: "test" }
  );
});

test("dispatchFetch: throws error if pass through with no upstream", async (t) => {
  const { module } = t.context;
  module.addEventListener("fetch", (e) => {
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () => module.dispatchFetch(new Request("http://localhost:8787/")),
    {
      instanceOf: FetchError,
      message: "Unable to proxy request to upstream: no upstream specified",
    }
  );
});

test("dispatchScheduled: dispatches event", async (t) => {
  const { module } = t.context;
  module.addEventListener("scheduled", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.waitUntil(Promise.resolve(2));
  });
  module.addEventListener("scheduled", (e) => {
    e.waitUntil(Promise.resolve(3));
    e.waitUntil(Promise.resolve(e.scheduledTime));
  });
  const res = await module.dispatchScheduled(1000);
  t.deepEqual(res, [1, 2, 3, 1000]);
});
