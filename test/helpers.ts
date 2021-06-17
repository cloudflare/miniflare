import { promises as fs } from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { URL } from "url";
import { promisify } from "util";
import vm from "vm";
import { ExecutionContext } from "ava";
import rimraf from "rimraf";
import { Log, Miniflare, Options, Request } from "../src";
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

export async function useServer(
  t: ExecutionContext,
  listener: http.RequestListener
): Promise<URL> {
  return new Promise((resolve) => {
    const server = http.createServer(listener);
    // 0 binds to random unused port
    server.listen(0, () => {
      t.teardown(() => server.close());
      resolve(
        new URL(`http://localhost:${(server.address() as AddressInfo).port}`)
      );
    });
  });
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

export class TestLog implements Log {
  debugs: string[] = [];
  errors: string[] = [];
  infos: string[] = [];
  logs: string[] = [];
  warns: string[] = [];

  debug(data: string): void {
    this.debugs.push(data);
  }

  error(data: string): void {
    this.errors.push(data);
  }

  info(data: string): void {
    this.infos.push(data);
  }

  log(data: string): void {
    this.logs.push(data);
  }

  warn(data: string): void {
    this.warns.push(data);
  }
}
