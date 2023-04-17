import fs from "fs/promises";
import path from "path";
import { Miniflare, MiniflareOptions } from "@miniflare/tre";
import test from "ava";
import { getPort, useTmp } from "../../test-shared";

const COUNTER_SCRIPT = (responsePrefix = "") => `export class Counter {
  constructor(state) {
    this.storage = state.storage;
  }
  async fetch(request) {
    const count = ((await this.storage.get("count")) ?? 0) + 1;
    void this.storage.put("count", count);
    return new Response(${JSON.stringify(responsePrefix)} + count);
  }
}
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const OBJECT = env[request.headers.get("MF-Test-Object") ?? "COUNTER"];
    const id = OBJECT.idFromName(pathname);
    const stub = OBJECT.get(id);
    return stub.fetch(request);
  },
};`;

test("persists Durable Object data in-memory between options reloads", async (t) => {
  const opts: MiniflareOptions = {
    port: await getPort(),
    modules: true,
    script: COUNTER_SCRIPT("Options #1: "),
    durableObjects: { COUNTER: "Counter" },
  };
  let mf = new Miniflare(opts);
  t.teardown(() => mf.dispose());

  let res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "Options #1: 1");

  opts.script = COUNTER_SCRIPT("Options #2: ");
  await mf.setOptions(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "Options #2: 2");

  opts.durableObjectsPersist = false;
  opts.script = COUNTER_SCRIPT("Options #3: ");
  await mf.setOptions(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "Options #3: 3");

  opts.durableObjectsPersist = "memory:";
  opts.script = COUNTER_SCRIPT("Options #4: ");
  await mf.setOptions(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "Options #4: 4");

  // Check a `new Miniflare()` instance has its own in-memory storage
  delete opts.durableObjectsPersist;
  opts.script = COUNTER_SCRIPT("Options #5: ");
  await mf.dispose();
  mf = new Miniflare(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "Options #5: 1");
});

test("persists Durable Object data on file-system", async (t) => {
  const tmp = await useTmp(t);
  const opts: MiniflareOptions = {
    name: "worker",
    port: await getPort(),
    modules: true,
    script: COUNTER_SCRIPT(),
    durableObjects: { COUNTER: "Counter" },
    durableObjectsPersist: tmp,
  };
  let mf = new Miniflare(opts);
  t.teardown(() => mf.dispose());

  let res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "1");

  // Check directory created for "worker"'s Durable Object
  const names = await fs.readdir(tmp);
  t.deepEqual(names, ["worker-Counter"]);

  // Check reloading keeps persisted data
  await mf.setOptions(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "2");

  // Check removing persisted data then reloaded resets count (note we have to
  // reload here as `workerd` keeps a copy of the SQLite database in-memory,
  // we also need to `dispose()` to avoid `EBUSY` error on Windows)
  await mf.dispose();
  await fs.rm(path.join(tmp, names[0]), { force: true, recursive: true });

  mf = new Miniflare(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "1");

  // Check "restarting" keeps persisted data
  await mf.dispose();
  mf = new Miniflare(opts);
  res = await mf.dispatchFetch("http://localhost");
  t.is(await res.text(), "2");
});

test("multiple Workers access same Durable Object data", async (t) => {
  const tmp = await useTmp(t);
  const mf = new Miniflare({
    port: await getPort(),
    durableObjectsPersist: tmp,
    workers: [
      {
        name: "entry",
        modules: true,
        script: `export default {
          async fetch(request, env, ctx) {
            request = new Request(request);
            const service = request.headers.get("MF-Test-Service");
            request.headers.delete("MF-Test-Service");
            const response = await env[service].fetch(request);
            const text = await response.text();
            return new Response(\`via \${service}: \${text}\`);
          }
        }`,
        serviceBindings: { A: "a", B: "b" },
      },
      {
        name: "a",
        modules: true,
        script: COUNTER_SCRIPT("a: "),
        durableObjects: {
          COUNTER_A: "Counter",
          COUNTER_B: { className: "Counter", scriptName: "b" },
        },
      },
      {
        name: "b",
        modules: true,
        script: COUNTER_SCRIPT("b: "),
        durableObjects: {
          COUNTER_A: { className: "Counter", scriptName: "a" },
          COUNTER_B: "Counter",
        },
      },
    ],
  });
  t.teardown(() => mf.dispose());

  let res = await mf.dispatchFetch("http://localhost", {
    headers: { "MF-Test-Service": "A", "MF-Test-Object": "COUNTER_A" },
  });
  t.is(await res.text(), "via A: a: 1");
  res = await mf.dispatchFetch("http://localhost", {
    headers: { "MF-Test-Service": "A", "MF-Test-Object": "COUNTER_A" },
  });
  t.is(await res.text(), "via A: a: 2");
  res = await mf.dispatchFetch("http://localhost", {
    headers: { "MF-Test-Service": "A", "MF-Test-Object": "COUNTER_B" },
  });
  t.is(await res.text(), "via A: b: 1");

  // Check directory created for Durable Objects
  const names = await fs.readdir(tmp);
  t.deepEqual(names.sort(), ["a-Counter", "b-Counter"]);

  // Check accessing via a different service accesses same persisted data
  res = await mf.dispatchFetch("http://localhost", {
    headers: { "MF-Test-Service": "B", "MF-Test-Object": "COUNTER_A" },
  });
  t.is(await res.text(), "via B: a: 3");
  res = await mf.dispatchFetch("http://localhost", {
    headers: { "MF-Test-Service": "B", "MF-Test-Object": "COUNTER_B" },
  });
  t.is(await res.text(), "via B: b: 2");
});
