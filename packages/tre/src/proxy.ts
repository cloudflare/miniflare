import { mkdir, readFile, stat, writeFile } from "fs/promises";
import http from "http";
import path from "path";
import { IncomingRequestCfProperties, fetch } from "@miniflare/core";
import getPort from "get-port";
import { bold, dim, green, grey, red } from "kleur/colors";
import stoppable, { StoppableServer } from "stoppable";
import { Request, RequestInfo, RequestInit, Response } from "undici";
import { MessageEvent, WebSocket, WebSocketServer } from "ws";
import { OptionalZodTypeOf } from "./helpers";
import { CfHeader, Plugins } from "./plugins";

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
      delete request.headers["sec-websocket-version"];
      delete request.headers["sec-websocket-key"];
      delete request.headers["sec-websocket-extensions"];
      request.headers[CfHeader.Blob] = JSON.stringify(this.#cf);

      const wsRuntimeEntryURL = new URL(this.runtimeURL!.href);
      wsRuntimeEntryURL.protocol = "ws";

      const runtime = new WebSocket(new URL(request.url!, wsRuntimeEntryURL), {
        headers: request.headers,
      });

      // Proxy messages to and from the runtime
      client.addEventListener("message", (e: MessageEvent) =>
        runtime.send(e.data)
      );
      client.addEventListener("close", (e) => {
        if (e.code === 1005 /* No Status Received */) {
          runtime.close();
        } else {
          runtime.close(e.code, e.reason);
        }
      });

      runtime.addEventListener("message", (e: MessageEvent) => {
        client.send(e.data);
      });
      runtime.addEventListener("close", (e) => {
        if (e.code === 1005 /* No Status Received */) {
          client.close();
        } else {
          client.close(e.code, e.reason);
        }
      });
    });
    const server = http.createServer((originalRequest, originalResponse) => {
      originalRequest.headers[CfHeader.Blob] = JSON.stringify(this.#cf);

      const runtimeRequest = http.request(
        {
          hostname: this.runtimeURL!.hostname,
          port: this.runtimeURL!.port,
          path: originalRequest.url,
          method: originalRequest.method,
          headers: originalRequest.headers,
        },
        (runtimeResponse) => {
          originalResponse.writeHead(
            runtimeResponse.statusCode as number,
            runtimeResponse.headers
          );
          runtimeResponse.pipe(originalResponse);
        }
      );

      originalRequest.pipe(runtimeRequest);
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
  dispatchFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const forward = new Request(input, init);
    forward.headers.set(CfHeader.Blob, JSON.stringify(this.#cf));
    const url = new URL(forward.url);
    url.host = this.runtimeURL!.host;
    return fetch(url, forward as RequestInit);
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
