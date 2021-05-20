import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import vm from "vm";
import { ExecutionContext } from "ava";
import rimraf from "rimraf";
import { Miniflare, Options, Request } from "../src";
import { sanitise } from "../src/kv/helpers";

export async function useTmp(t: ExecutionContext): Promise<string> {
  const randomHex = Array.from(Array(8))
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
  const filePath = path.resolve(".tmp", `${sanitise(t.title)}-${randomHex}`);
  await fs.mkdir(filePath, { recursive: true });
  t.teardown(() =>
    t.passed ? promisify(rimraf)(filePath) : Promise.resolve()
  );
  return filePath;
}

export async function runInWorker<T>(
  options: Options,
  f: () => Promise<T>
): Promise<T> {
  const script = `
  addEventListener("fetch", (e) => {
    e.respondWith(
      (${f.toString()})().then((v) => {
        return new Response(JSON.stringify(v === undefined ? null : v), {
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });
  `;
  const mf = new Miniflare(new vm.Script(script), options);
  const res = await mf.dispatchFetch(new Request("http://localhost:8787"));
  return res.json();
}

export function wait(t: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, t));
}
