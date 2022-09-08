import assert from "assert";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { IncomingHttpHeaders } from "http";
import http from "http";
import path from "path";
import { IncomingRequestCfProperties, fetch } from "@miniflare/core";
import getPort from "get-port";
import { bold, dim, green, grey, red } from "kleur/colors";
import stoppable, { StoppableServer } from "stoppable";
import {
  Headers,
  HeadersInit,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "undici";
import { MessageEvent, WebSocket, WebSocketServer } from "ws";
import { OptionalZodTypeOf } from "./helpers";
import { CfHeader, Plugins } from "./plugins";

export function filterWebSocketHeaders(
  headers: IncomingHttpHeaders
): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([h]) =>
        ![
          "sec-websocket-version",
          "sec-websocket-key",
          "sec-websocket-extensions",
        ].includes(h)
    )
  );
}

export function injectCfHeaders(
  headers: HeadersInit | IncomingHttpHeaders,
  cf: object
) {
  let entries: [string, string | readonly string[] | undefined][];
  if (typeof headers.entries == "function") {
    entries = [...(headers as Headers).entries()];
  } else if (Array.isArray(headers)) {
    assert(headers.every((h) => h.length == 2));
    entries = headers as [string, string][];
  } else {
    entries = Object.entries(headers);
  }
  return {
    ...Object.fromEntries(entries),
    [CfHeader.Blob]: JSON.stringify(cf),
  };
}

const defaultCfPath = path.resolve("node_modules", ".mf", "cf.json");
const defaultCfFetch = process.env.NODE_ENV !== "test";
const defaultCfFetchEndpoint = "https://workers.cloudflare.com/cf.json";
const fallbackCf: IncomingRequestCfProperties = {
  asn: 395747,
  colo: "DFW",
  city: "Austin",
  region: "Texas",
  regionCode: "TX",
  metroCode: "635",
  postalCode: "78701",
  country: "US",
  continent: "NA",
  timezone: "America/Chicago",
  latitude: "30.27130",
  longitude: "-97.74260",
  clientTcpRtt: 0,
  httpProtocol: "HTTP/1.1",
  requestPriority: "weight=192;exclusive=0",
  tlsCipher: "AEAD-AES128-GCM-SHA256",
  tlsVersion: "TLSv1.3",
  tlsClientAuth: {
    certIssuerDNLegacy: "",
    certIssuerDN: "",
    certPresented: "0",
    certSubjectDNLegacy: "",
    certSubjectDN: "",
    certNotBefore: "",
    certNotAfter: "",
    certSerial: "",
    certFingerprintSHA1: "",
    certVerified: "NONE",
  },
};
// Milliseconds in 1 day
export const DAY = 86400000;
// Max age in days of cf.json
export const CF_DAYS = 30;

type CoreOptions = OptionalZodTypeOf<Plugins["core"]["sharedOptions"]>;
export class ProxyServer {
  #options: CoreOptions;
  #server?: StoppableServer;
  #cf = fallbackCf;

  runtimeURL?: URL;

  readonly #initPromise: Promise<void>;

  constructor(options: CoreOptions) {
    this.#options = options;

    this.#initPromise = this.#setupCf();
  }

  async #setupCf(): Promise<void> {
    // Default to enabling cfFetch if we're not testing
    let cfPath = this.#options.cfFetch ?? defaultCfFetch;
    // If cfFetch is disabled or we're using a custom provider, don't fetch the
    // cf object
    if (!cfPath) return;
    if (cfPath === true) cfPath = defaultCfPath;
    // Determine whether to refetch cf.json, should do this if doesn't exist
    // or expired

    // Determine whether to refetch cf.json, should do this if doesn't exist
    // or expired
    let refetch = true;
    try {
      // Try load cfPath, if this fails, we'll catch the error and refetch.
      // If this succeeds, and the file is stale, that's fine: it's very likely
      // we'll be fetching the same data anyways.
      this.#cf = JSON.parse(await readFile(cfPath, "utf8"));
      const cfStat = await stat(cfPath);
      refetch = Date.now() - cfStat.mtimeMs > CF_DAYS * DAY;
    } catch {}

    // If no need to refetch, stop here, otherwise fetch
    if (!refetch) return;
    try {
      const res = await fetch(defaultCfFetchEndpoint);
      const cfText = await res.text();
      this.#cf = JSON.parse(cfText);
      // Write cf so we can reuse it later
      await mkdir(path.dirname(cfPath), { recursive: true });
      await writeFile(cfPath, cfText, "utf8");
      console.log(grey("Updated `Request.cf` object cache!"));
    } catch (e: any) {
      console.log(
        bold(
          red(`Unable to fetch the \`Request.cf\` object! Falling back to a default placeholder...
${dim(e.cause ? e.cause.stack : e.stack)}`)
        )
      );
    }
  }
  // Initialise a proxy server that adds the `CF-Blob` header to runtime requests
  createServer() {
    const proxyWebSocketServer = new WebSocketServer({ noServer: true });
    proxyWebSocketServer.on("connection", (client, request) => {
      // Filter out browser WebSocket headers, since `ws` injects some. Leaving browser ones in causes key mismatches, especially with `Sec-WebSocket-Accept`
      const safeHeaders = filterWebSocketHeaders(request.headers);

      const runtime = new WebSocket(
        `ws://127.0.0.1:${Number(this.runtimeURL?.port)}${request.url}`,
        {
          headers: injectCfHeaders(safeHeaders, this.#cf),
        }
      );

      // Proxy messages to and from the runtime
      client.addEventListener("message", (e: MessageEvent) =>
        runtime.send(e.data)
      );
      client.addEventListener("close", () => runtime.close());

      runtime.addEventListener("message", (e: MessageEvent) => {
        client.send(e.data);
      });
      runtime.addEventListener("close", () => client.close());
    });
    const server = http.createServer((originalRequest, originalResponse) => {
      const proxyToRuntime = http.request(
        {
          hostname: "127.0.0.1",
          port: Number(this.runtimeURL?.port),
          path: originalRequest.url,
          method: originalRequest.method,
          headers: injectCfHeaders(originalRequest.headers, this.#cf),
        },
        (runtime) => {
          originalResponse.writeHead(
            runtime.statusCode as number,
            runtime.headers
          );
          runtime.pipe(originalResponse);
        }
      );

      originalRequest.pipe(proxyToRuntime);
    });
    // Handle websocket requests
    server.on("upgrade", (request, socket, head) => {
      proxyWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
        proxyWebSocketServer.emit("connection", ws, request);
      });
    });

    return server;
  }

  async startServer() {
    const port = await getPort({ port: this.#options.port });
    const host = this.#options.host ?? "127.0.0.1";
    this.#server = stoppable(this.createServer());

    await new Promise<void>((resolve) => {
      (this.#server as StoppableServer).listen(port, host, () => resolve());
    });
    console.log(bold(green(`Ready on http://${host}:${port}! 🎉`)));
  }
  async dispatchFetch(
    input: RequestInfo,
    init?: RequestInit
  ): Promise<Response> {
    let forward: Request;
    let url: URL;
    // Depending on the form of the input, construct a new request with the `host` set to the internal runtime URL
    if (input instanceof URL || typeof input == "string") {
      url = input instanceof URL ? input : new URL(input as string);
      url.host = (this.runtimeURL as URL).host;
      forward = new Request(url, {
        ...init,
        headers: injectCfHeaders(init?.headers ?? {}, this.#cf),
      });
    } else {
      url = new URL(input.url);
      url.host = (this.runtimeURL as URL).host;
      forward = new Request(url, {
        ...(input as RequestInit),
        headers: injectCfHeaders(input?.headers ?? {}, this.#cf),
      });
    }
    return await fetch(url, forward as RequestInit);
  }
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#server !== undefined)
        this.#server.stop((err) => (err ? reject(err) : resolve()));
    });
  }
  get ready() {
    return this.#initPromise;
  }
}
