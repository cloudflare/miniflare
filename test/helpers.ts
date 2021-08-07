import assert from "assert";
import { promises as fs } from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { URL } from "url";
import { promisify } from "util";
import { ExecutionContext } from "ava";
import rimraf from "rimraf";
import StandardWebSocket from "ws";
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
  listener: http.RequestListener,
  webSocketListener?: (
    socket: StandardWebSocket,
    req: http.IncomingMessage
  ) => void
): Promise<{ http: URL; ws: URL }> {
  return new Promise((resolve) => {
    const server = http.createServer(listener);
    // Only setup web socket server if listener provided
    if (webSocketListener) {
      const wss = new StandardWebSocket.Server({ server });
      wss.on("connection", webSocketListener);
    }
    // 0 binds to random unused port
    server.listen(0, () => {
      t.teardown(() => server.close());
      const port = (server.address() as AddressInfo).port;
      resolve({
        http: new URL(`http://localhost:${port}`),
        ws: new URL(`ws://localhost:${port}`),
      });
    });
  });
}

export async function runInWorker<T>(
  options: Options,
  f: () => T | Promise<T>
): Promise<T> {
  const script = `
  addEventListener("fetch", (e) => {
    e.respondWith(
      Promise.resolve((${f.toString()})()).then((v) => {
        return new Response(JSON.stringify(v === undefined ? null : v), {
          headers: { "Content-Type": "application/json" },
        });
      })
    );
  });
  `;
  const mf = new Miniflare({ ...options, script });
  const res = await mf.dispatchFetch(new Request("http://localhost:8787"));
  return res.json();
}

export function noop(): void {}

export function triggerPromise<T>(): [
  trigger: (result: T) => void,
  promise: Promise<T>
] {
  let trigger: (result: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (trigger = resolve));
  return [trigger, promise];
}

export function wait(t: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, t));
}

export function within(
  t: ExecutionContext,
  epsilon: number,
  actual?: number,
  expected?: number
): void {
  t.not(actual, undefined);
  t.not(expected, undefined);
  assert(actual !== undefined && expected !== undefined);
  const difference = Math.abs(actual - expected);
  t.true(
    difference <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}, difference is ${difference}`
  );
}

export function includesPathRegexp(path: string): RegExp {
  // Escape \ for Windows paths
  return new RegExp(path.replace(/\\/g, "\\\\"));
}

export function getObjectProperties<T>(obj: T): string[] {
  return [
    ...Object.getOwnPropertyNames(obj),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(obj)),
  ]
    .filter((property) => property !== "constructor")
    .sort();
}

export class TestLog implements Log {
  logs: string[] = [];
  debugs: string[] = [];
  infos: string[] = [];
  warns: string[] = [];
  errors: string[] = [];

  log(data: string): void {
    this.logs.push(data);
  }

  debug(data: string): void {
    this.debugs.push(data);
  }

  info(data: string): void {
    this.infos.push(data);
  }

  warn(data: string): void {
    this.warns.push(data);
  }

  error(data: string): void {
    this.errors.push(data);
  }
}
