import anyTest, { TestInterface } from "ava";
import {
  FetchError,
  FetchEvent,
  Miniflare,
  NoOpLog,
  Request,
  Response,
  ScheduledEvent,
} from "../../src";
import {
  EventsModule,
  ServiceWorkerGlobalScope,
  addModuleFetchListenerSymbol,
  addModuleScheduledListenerSymbol,
  dispatchFetchSymbol,
  dispatchScheduledSymbol,
  passThroughSymbol,
  responseSymbol,
  waitUntilSymbol,
} from "../../src/modules/events";
import { TestLog, getObjectProperties, useServer } from "../helpers";

interface Context {
  log: TestLog;
  globalScope: ServiceWorkerGlobalScope;
}

const test = anyTest as TestInterface<Context>;

test.beforeEach((t) => {
  const log = new TestLog();
  const globalScope = new ServiceWorkerGlobalScope(
    log,
    {},
    { KEY: "value" },
    true // modules mode, so environment only included in env not global
  );
  t.context = { log, globalScope };
});

test("ServiceWorkerGlobalScope: includes sandbox in globals", async (t) => {
  const globalScope = new ServiceWorkerGlobalScope(
    new NoOpLog(),
    { sand: "box" },
    {},
    false
  );
  t.is((globalScope as any).sand, "box");
});
test("ServiceWorkerGlobalScope: includes environment in globals if modules disabled", async (t) => {
  let globalScope = new ServiceWorkerGlobalScope(
    new NoOpLog(),
    {},
    { env: "ironment" },
    false
  );
  t.is((globalScope as any).env, "ironment");
  globalScope = new ServiceWorkerGlobalScope(
    new NoOpLog(),
    {},
    { env: "ironment" },
    true
  );
  t.is((globalScope as any).env, undefined);
});
test("ServiceWorkerGlobalScope: includes global self-references", async (t) => {
  const { globalScope } = t.context;
  t.is(globalScope.global, globalScope);
  t.is(globalScope.globalThis, globalScope);
  t.is(globalScope.self, globalScope);
});
test("ServiceWorkerGlobalScope: hides implementation details", async (t) => {
  const { globalScope } = t.context;
  t.deepEqual(getObjectProperties(globalScope), [
    // EventTarget methods included twice for superclass
    "addEventListener",
    "addEventListener",
    "dispatchEvent",
    "dispatchEvent",
    "global",
    "globalThis",
    "removeEventListener",
    "removeEventListener",
    "self",
  ]);
});

test("addModuleFunctionListener: adds event listener", async (t) => {
  const { globalScope } = t.context;
  globalScope[addModuleFetchListenerSymbol]((request, env, ctx) => {
    ctx.passThroughOnException();
    ctx.waitUntil(Promise.resolve(env.KEY));
    return new Response(request.url);
  });
  const event = new FetchEvent(new Request("http://localhost:8787/"));
  globalScope.dispatchEvent(event);
  t.true(event[passThroughSymbol]);
  t.deepEqual(await Promise.all(event[waitUntilSymbol]), ["value"]);
  t.is(await (await event[responseSymbol])?.text(), "http://localhost:8787/");
});

test("addModuleScheduledListener: adds event listener", async (t) => {
  const { globalScope } = t.context;
  globalScope[addModuleScheduledListenerSymbol]((controller, env, ctx) => {
    ctx.waitUntil(Promise.resolve(env.KEY));
    ctx.waitUntil(Promise.resolve(controller.scheduledTime));
    return controller.cron;
  });
  const event = new ScheduledEvent(1000, "30 * * * *");
  globalScope.dispatchEvent(event);
  t.deepEqual(await Promise.all(event[waitUntilSymbol]), [
    "value",
    1000,
    "30 * * * *",
  ]);
});

test("buildSandbox: includes event classes", async (t) => {
  const module = new EventsModule(new NoOpLog());
  const sandbox = module.buildSandbox();

  t.true(typeof sandbox.Event === "function");
  t.true(typeof sandbox.EventTarget === "function");
  t.true(typeof sandbox.FetchEvent === "function");
  t.true(typeof sandbox.ScheduledEvent === "function");
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
    sandbox.addEventListener("scheduled", (e: ScheduledEvent) => {
      e.waitUntil(Promise.resolve(e.scheduledTime));
      e.waitUntil(Promise.resolve(e.cron));
    });
  }).toString()})()`;
  const mf = new Miniflare({ script });
  const res = await mf.dispatchScheduled(1000, "30 * * * *");
  t.is(res[0], 1000);
  t.is(res[1], "30 * * * *");
});
test("buildSandbox: adds module fetch event listener", async (t) => {
  const script = `export default {
    fetch(request, env, ctx) {
      ctx.waitUntil(Promise.resolve(env.KEY));
      return new Response(request.url);
    }
  }`;
  const mf = new Miniflare({
    modules: true,
    script,
    bindings: { KEY: "value" },
  });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
  t.deepEqual(await res.waitUntil(), ["value"]);
});
test("buildSandbox: adds module scheduled event listener", async (t) => {
  const script = `export default {
    scheduled(controller, env, ctx) {
      ctx.waitUntil(Promise.resolve(controller.scheduledTime));
      ctx.waitUntil(Promise.resolve(controller.cron));
      ctx.waitUntil(Promise.resolve(env.KEY));
    }
  }`;
  const mf = new Miniflare({
    modules: true,
    script,
    bindings: { KEY: "value" },
  });
  const res = await mf.dispatchScheduled(1000, "30 * * * *");
  t.is(res[0], 1000);
  t.is(res[1], "30 * * * *");
  t.is(res[2], "value");
});

test("dispatchFetch: dispatches event", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.respondWith(new Response(e.request.url));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
});
test("dispatchFetch: dispatches event with promise response", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.respondWith(Promise.resolve(new Response(e.request.url)));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
});
test("dispatchFetch: stops calling listeners after first response", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.waitUntil(Promise.resolve(2));
  });
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(3));
    e.respondWith(new Response(e.request.url));
  });
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(4));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
  t.deepEqual(await res.waitUntil(), [1, 2, 3]);
});
test("dispatchFetch: stops calling listeners after first error", async (t) => {
  t.plan(3);
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", () => {
    t.pass();
  });
  globalScope.addEventListener("fetch", () => {
    t.pass();
    if (1 === 1) throw new Error("test");
  });
  globalScope.addEventListener("fetch", () => {
    t.fail();
  });
  await t.throwsAsync(
    () =>
      globalScope[dispatchFetchSymbol](new Request("http://localhost:8787/")),
    { instanceOf: Error, message: "test" }
  );
});
test("dispatchFetch: passes through to upstream on no response", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request(upstream),
    upstream
  );
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("dispatchFetch: passes through to upstream on error", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request(upstream),
    upstream
  );
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("dispatchFetch: passes through to upstream on async error", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.passThroughOnException();
    e.respondWith(Promise.reject(new Error("test")));
  });
  const res = await globalScope[dispatchFetchSymbol](
    new Request(upstream),
    upstream
  );
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("dispatchFetch: throws error if no pass through on listener error", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () =>
      globalScope[dispatchFetchSymbol](new Request("http://localhost:8787/")),
    { instanceOf: Error, message: "test" }
  );
});
test("dispatchFetch: throws error if pass through with no upstream", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () =>
      globalScope[dispatchFetchSymbol](new Request("http://localhost:8787/")),
    {
      instanceOf: FetchError,
      message: /^No fetch handler responded and unable to proxy request to upstream/,
    }
  );
});

test("dispatchScheduled: dispatches event", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("scheduled", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.waitUntil(Promise.resolve(2));
  });
  globalScope.addEventListener("scheduled", (e) => {
    e.waitUntil(Promise.resolve(3));
    e.waitUntil(Promise.resolve(e.scheduledTime));
    e.waitUntil(Promise.resolve(e.cron));
  });
  const res = await globalScope[dispatchScheduledSymbol](1000, "30 * * * *");
  t.deepEqual(res, [1, 2, 3, 1000, "30 * * * *"]);
});
test("dispatchScheduled: stops calling listeners after first error", async (t) => {
  t.plan(3);
  const { globalScope } = t.context;
  globalScope.addEventListener("scheduled", () => {
    t.pass();
  });
  globalScope.addEventListener("scheduled", () => {
    t.pass();
    if (1 === 1) throw new Error("test");
  });
  globalScope.addEventListener("scheduled", () => {
    t.fail();
  });
  await t.throwsAsync(() => globalScope[dispatchScheduledSymbol](), {
    instanceOf: Error,
    message: "test",
  });
});

test("FetchEvent: hides implementation details", (t) => {
  const event = new FetchEvent(new Request("http://localhost:8787"));
  t.deepEqual(getObjectProperties(event), [
    "isTrusted",
    "passThroughOnException",
    "request",
    "respondWith",
    "waitUntil",
  ]);
});
test("ScheduledEvent: hides implementation details", (t) => {
  const event = new ScheduledEvent(1000, "30 * * * *");
  t.deepEqual(getObjectProperties(event), [
    "cron",
    "isTrusted",
    "scheduledTime",
    "waitUntil",
  ]);
});
