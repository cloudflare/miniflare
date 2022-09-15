import { mkdir, readFile, stat, writeFile } from "fs/promises";
import net, { Server } from "net";
import path from "path";
import { compose } from "stream";
import { IncomingRequestCfProperties, fetch } from "@miniflare/core";
import getPort from "get-port";
import { bold, dim, green, grey, red } from "kleur/colors";
import { Request, RequestInfo, RequestInit, Response } from "undici";
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
  #server?: Server;
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
  createServer(): Server {
    function injectHeader(name: string, value: string) {
      function transformHeaders(headers: Buffer): Buffer {
        return Buffer.concat([headers, Buffer.from(`\r\n${name}: ${value}`)]);
      }
      return async function* (source: AsyncIterable<Buffer>) {
        let hasConsumedHeaders = false;
        let headers = Buffer.from([]);
        for await (const chunk of source) {
          if (hasConsumedHeaders) {
            yield chunk;
          } else {
            const received = Buffer.concat([headers, chunk]);
            if (received.includes("\r\n\r\n")) {
              const index = received.indexOf("\r\n\r\n");
              const pre = Buffer.from(received.slice(0, index));
              const post = Buffer.from(received.slice(index));
              hasConsumedHeaders = true;
              yield Buffer.concat([transformHeaders(pre), post]);
            } else {
              headers = Buffer.concat([headers, chunk]);
            }
          }
        }
      };
    }

    const tcpServer = net.createServer((conn) => {
      const runtime = net.createConnection(
        Number(this.runtimeURL!.port),
        this.runtimeURL!.hostname
      );
      conn
        .pipe(compose(injectHeader(CfHeader.Blob, JSON.stringify(this.#cf))))
        .pipe(runtime);
      conn.on("end", () => runtime.end());
      conn.on("error", () => runtime.end());
      runtime.on("error", () => conn.end());
      runtime.on("end", () => conn.end());
      runtime.pipe(compose(injectHeader("Connection", "close"))).pipe(conn);
    });

    return tcpServer;
  }

  async startServer() {
    const port = await getPort({ port: this.#options.port });
    const host = this.#options.host ?? "127.0.0.1";
    this.#server = this.createServer();

    await new Promise<void>((resolve) => {
      this.#server!.listen(port, host, () => resolve());
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
        this.#server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  get ready() {
    return this.#initPromise;
  }
}
