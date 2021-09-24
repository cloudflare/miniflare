import {
  BindingsPlugin,
  CorePlugin,
  FetchEvent,
  Request,
  Response,
  ScheduledEvent,
  ServiceWorkerGlobalScope,
  kDispatchFetch,
  kDispatchScheduled,
} from "@miniflare/core";
import anyTest, { TestInterface } from "ava";
import {
  NoOpLog,
  TestLog,
  getObjectProperties,
  useMiniflare,
  useServer,
} from "test:@miniflare/shared";

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

test("MiniflareCore: adds fetch event listener", async (t) => {
  const script = `(${(() => {
    const sandbox = self as any;
    sandbox.addEventListener("fetch", (e: FetchEvent) => {
      e.respondWith(new sandbox.Response(e.request.url));
    });
  }).toString()})()`;
  const mf = useMiniflare({ CorePlugin }, { script });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
});
test("MiniflareCore: adds scheduled event listener", async (t) => {
  const script = `(${(() => {
    const sandbox = self as any;
    sandbox.addEventListener("scheduled", (e: ScheduledEvent) => {
      e.waitUntil(Promise.resolve(e.scheduledTime));
      e.waitUntil(Promise.resolve(e.cron));
    });
  }).toString()})()`;
  const mf = useMiniflare({ CorePlugin }, { script });
  const res = await mf.dispatchScheduled(1000, "30 * * * *");
  t.is(res[0], 1000);
  t.is(res[1], "30 * * * *");
});
test("MiniflareCore: adds module fetch event listener", async (t) => {
  const script = `export default {
    fetch(request, env, ctx) {
      ctx.waitUntil(Promise.resolve(env.KEY));
      return new Response(request.url);
    }
  }`;
  const mf = useMiniflare(
    { CorePlugin, BindingsPlugin },
    { modules: true, script, bindings: { KEY: "value" } }
  );
  const res = await mf.dispatchFetch(new Request("http://localhost:8787/"));
  t.is(await res.text(), "http://localhost:8787/");
  t.deepEqual(await res.waitUntil(), ["value"]);
});
test("MiniflareCore: adds module scheduled event listener", async (t) => {
  const script = `export default {
    scheduled(controller, env, ctx) {
      ctx.waitUntil(Promise.resolve(controller.scheduledTime));
      ctx.waitUntil(Promise.resolve(controller.cron));
      ctx.waitUntil(Promise.resolve(env.KEY));
    }
  }`;
  const mf = useMiniflare(
    { CorePlugin, BindingsPlugin },
    { modules: true, script, bindings: { KEY: "value" } }
  );
  const res = await mf.dispatchScheduled(1000, "30 * * * *");
  t.is(res[0], 1000);
  t.is(res[1], "30 * * * *");
  t.is(res[2], "value");
});

test("kDispatchFetch: dispatches event", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.respondWith(new Response(e.request.url));
  });
  const res = await globalScope[kDispatchFetch](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
});
test("kDispatchFetch: dispatches event with promise response", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.respondWith(Promise.resolve(new Response(e.request.url)));
  });
  const res = await globalScope[kDispatchFetch](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
});
test("kDispatchFetch: stops calling listeners after first response", async (t) => {
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
  const res = await globalScope[kDispatchFetch](
    new Request("http://localhost:8787/")
  );
  t.is(await res.text(), "http://localhost:8787/");
  t.deepEqual(await res.waitUntil(), [1, 2, 3]);
});
test("kDispatchFetch: stops calling listeners after first error", async (t) => {
  t.plan(3);
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", () => {
    t.pass();
  });
  globalScope.addEventListener("fetch", () => {
    t.pass();
    if (1 === 1) throw new TypeError("test");
  });
  globalScope.addEventListener("fetch", () => {
    t.fail();
  });
  await t.throwsAsync(
    () => globalScope[kDispatchFetch](new Request("http://localhost:8787/")),
    { instanceOf: TypeError, message: "test" }
  );
});
test("kDispatchFetch: passes through to upstream on no response", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
  });
  const res = await globalScope[kDispatchFetch](new Request(upstream), true);
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("kDispatchFetch: passes through to upstream on error", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  const res = await globalScope[kDispatchFetch](new Request(upstream), true);
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("kDispatchFetch: passes through to upstream on async error", async (t) => {
  const upstream = (await useServer(t, (req, res) => res.end("upstream"))).http;
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.waitUntil(Promise.resolve(1));
    e.passThroughOnException();
    e.respondWith(Promise.reject(new Error("test")));
  });
  const res = await globalScope[kDispatchFetch](new Request(upstream), true);
  t.is(await res.text(), "upstream");
  t.deepEqual(await res.waitUntil(), [1]);
});
test("kDispatchFetch: throws error if no pass through on listener error", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () => globalScope[kDispatchFetch](new Request("http://localhost:8787/")),
    { instanceOf: Error, message: "test" }
  );
});
test("kDispatchFetch: throws error if pass through with no upstream", async (t) => {
  const { globalScope } = t.context;
  globalScope.addEventListener("fetch", (e) => {
    e.passThroughOnException();
    if (1 === 1) throw new Error("test");
    e.respondWith(new Response(e.request.url));
  });
  await t.throwsAsync(
    () => globalScope[kDispatchFetch](new Request("http://localhost:8787/")),
    {
      instanceOf: TypeError,
      message:
        /^No fetch handler responded and no upstream to proxy to specified/,
    }
  );
});

test("kDispatchScheduled: dispatches event", async (t) => {
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
  const res = await globalScope[kDispatchScheduled](1000, "30 * * * *");
  t.deepEqual(res, [1, 2, 3, 1000, "30 * * * *"]);
});
test("kDispatchScheduled: stops calling listeners after first error", async (t) => {
  t.plan(3);
  const { globalScope } = t.context;
  globalScope.addEventListener("scheduled", () => {
    t.pass();
  });
  globalScope.addEventListener("scheduled", () => {
    t.pass();
    if (1 === 1) throw new TypeError("test");
  });
  globalScope.addEventListener("scheduled", () => {
    t.fail();
  });
  await t.throwsAsync(() => globalScope[kDispatchScheduled](), {
    instanceOf: TypeError,
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
