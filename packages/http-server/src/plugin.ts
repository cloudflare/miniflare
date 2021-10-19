import { promises as fs } from "fs";
import http from "http";
import path from "path";
import { promisify } from "util";
import { IncomingRequestCfProperties } from "@miniflare/core";
import {
  Clock,
  Log,
  MaybePromise,
  Option,
  OptionType,
  Plugin,
  SetupResult,
  defaultClock,
} from "@miniflare/shared";
import type { Attributes, Options } from "selfsigned";
import { RequestInfo, fetch } from "undici";
import { getAccessibleHosts } from "./helpers";

// Milliseconds in 1 day
const DAY = 86400000;
// Max age in days of self-signed certificate
const CERT_DAYS = 30;
// Max age in days of cf.json
const CF_DAYS = 30;

export interface HTTPPluginDefaults {
  certRoot?: string;
  cfPath?: string;
  cfFetch?: boolean;
  cfFetchEndpoint?: RequestInfo;
  clock?: Clock;
}

const defaultCertRoot = path.resolve(".mf", "cert");
const defaultCfPath = path.resolve(".mf", "cf.json");
const defaultCfFetch = process.env.NODE_ENV !== "test";
const defaultCfFetchEndpoint = "https://workers.cloudflare.com/cf.json";
const defaultCf: IncomingRequestCfProperties = {
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

export interface ProcessedHTTPSOptions {
  key?: string;
  cert?: string;
  ca?: string;
  pfx?: string;
  passphrase?: string;
}

export interface HTTPOptions {
  host?: string;
  port?: number;

  https?: boolean | string;
  httpsKey?: string;
  httpsKeyPath?: string;
  httpsCert?: string;
  httpsCertPath?: string;
  httpsCa?: string;
  httpsCaPath?: string;
  httpsPfx?: string;
  httpsPfxPath?: string;
  httpsPassphrase?: string;

  cfFetch?: boolean | string;
  cfProvider?: (
    req: http.IncomingMessage
  ) => MaybePromise<IncomingRequestCfProperties>;
}

function valueOrFile(
  value?: string,
  filePath?: string
): MaybePromise<string | undefined> {
  return value ?? (filePath && fs.readFile(filePath, "utf8"));
}

export class HTTPPlugin extends Plugin<HTTPOptions> implements HTTPOptions {
  @Option({
    type: OptionType.STRING,
    alias: "H",
    description: "Host for HTTP(S) server to listen on",
    fromWrangler: ({ miniflare }) => miniflare?.host,
  })
  host?: string;

  @Option({
    type: OptionType.NUMBER,
    alias: "p",
    description: "Port for HTTP(S) server to listen on",
    fromWrangler: ({ miniflare }) => miniflare?.port,
  })
  port?: number;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Enable self-signed HTTPS (with optional cert path)",
    logName: "HTTPS",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object" ? undefined : miniflare?.https,
  })
  https?: boolean | string;

  @Option({ type: OptionType.NONE })
  httpsKey?: string;
  @Option({
    type: OptionType.STRING,
    name: "https-key",
    description: "Path to PEM SSL key",
    logName: "HTTPS Key",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object" ? miniflare.https?.key : undefined,
  })
  httpsKeyPath?: string;

  @Option({ type: OptionType.NONE })
  httpsCert?: string;
  @Option({
    type: OptionType.STRING,
    name: "https-cert",
    description: "Path to PEM SSL cert chain",
    logName: "HTTPS Cert",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object" ? miniflare.https?.cert : undefined,
  })
  httpsCertPath?: string;

  @Option({ type: OptionType.NONE })
  httpsCa?: string;
  @Option({
    type: OptionType.STRING,
    name: "https-ca",
    description: "Path to SSL trusted CA certs",
    logName: "HTTPS CA",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object" ? miniflare.https?.ca : undefined,
  })
  httpsCaPath?: string;

  @Option({ type: OptionType.NONE })
  httpsPfx?: string;
  @Option({
    type: OptionType.STRING,
    name: "https-pfx",
    description: "Path to PFX/PKCS12 SSL key/cert chain",
    logName: "HTTPS PFX",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object" ? miniflare.https?.pfx : undefined,
  })
  httpsPfxPath?: string;

  @Option({
    type: OptionType.STRING,
    description: "Passphrase to decrypt SSL files",
    logName: "HTTPS Passphrase",
    logValue: () => "**********",
    fromWrangler: ({ miniflare }) =>
      typeof miniflare?.https === "object"
        ? miniflare.https?.passphrase
        : undefined,
  })
  httpsPassphrase?: string;

  @Option({
    type: OptionType.BOOLEAN_STRING,
    description: "Path for cached Request cf object from Cloudflare",
    logName: "Request cf Object Fetch",
    logValue(value: boolean | string) {
      if (value === true) return path.relative("", defaultCfPath);
      if (value === false) return undefined;
      return path.relative("", value);
    },
    fromWrangler: ({ miniflare }) => miniflare?.cf_fetch,
  })
  cfFetch?: boolean | string;

  // TODO: should maybe provide cf headers stuff too?
  @Option({ type: OptionType.NONE })
  cfProvider?: (
    req: http.IncomingMessage
  ) => MaybePromise<IncomingRequestCfProperties>;

  private readonly defaultCertRoot: string;
  private readonly defaultCfPath: string;
  private readonly defaultCfFetch: boolean;
  private readonly cfFetchEndpoint: RequestInfo;
  private readonly clock: Clock;

  #cf = defaultCf;

  readonly httpsEnabled: boolean;
  #httpsOptions?: ProcessedHTTPSOptions;

  constructor(
    log: Log,
    options?: HTTPOptions,
    private readonly defaults: HTTPPluginDefaults = {}
  ) {
    super(log);
    this.assignOptions(options);

    this.defaultCertRoot = defaults.certRoot ?? defaultCertRoot;
    this.defaultCfPath = defaults.cfPath ?? defaultCfPath;
    this.defaultCfFetch = defaults.cfFetch ?? defaultCfFetch;
    this.cfFetchEndpoint = defaults.cfFetchEndpoint ?? defaultCfFetchEndpoint;
    this.clock = defaults.clock ?? defaultClock;

    this.httpsEnabled = !!(
      this.https ||
      this.httpsKey ||
      this.httpsKeyPath ||
      this.httpsCert ||
      this.httpsCertPath ||
      this.httpsCa ||
      this.httpsCaPath ||
      this.httpsPfx ||
      this.httpsPfxPath
    );
  }

  getCf(req: http.IncomingMessage): MaybePromise<IncomingRequestCfProperties> {
    if (this.cfProvider) return this.cfProvider(req);
    return this.#cf;
  }

  get httpsOptions(): ProcessedHTTPSOptions | undefined {
    return this.#httpsOptions;
  }

  async setupCf(): Promise<void> {
    // Default to enabling cfFetch if we're not testing
    let cfPath = this.cfFetch ?? this.defaultCfFetch;
    // If cfFetch is disabled or we're using a custom provider, don't fetch the
    // cf object
    if (!cfPath || this.cfProvider) return;
    if (cfPath === true) cfPath = this.defaultCfPath;
    // Determine whether to refetch cf.json, should do this if doesn't exist
    // or expired
    let refetch = true;
    try {
      // Try load cfPath, if this fails, we'll catch the error and refetch.
      // If this succeeds, and the file is stale, that's fine: it's very likely
      // we'll be fetching the same data anyways.
      this.#cf = JSON.parse(await fs.readFile(cfPath, "utf8"));
      const cfStat = await fs.stat(cfPath);
      refetch = this.clock() - cfStat.ctimeMs > CF_DAYS * DAY;
    } catch {}

    // If no need to refetch, stop here, otherwise fetch
    if (!refetch) return;
    try {
      const res = await fetch(this.cfFetchEndpoint);
      const cfText = await res.text();
      this.#cf = JSON.parse(cfText);
      // Write cf so we can reuse it later
      await fs.mkdir(path.dirname(cfPath), { recursive: true });
      await fs.writeFile(cfPath, cfText, "utf8");
      this.log.info("Updated Request cf object cache!");
    } catch (e: any) {
      // TODO: don't log this error so loudly
      this.log.error(e);
    }
  }

  async setupHttps(): Promise<void> {
    // If options are falsy, don't use HTTPS, no other HTTP setup required
    if (!this.httpsEnabled) return;

    // If https is true, use a self-signed certificate at default location
    let https = this.https;
    if (https === true) https = this.defaultCertRoot;
    // If https is now a string, use a self-signed certificate
    if (typeof https === "string") {
      const keyPath = path.join(https, "key.pem");
      const certPath = path.join(https, "cert.pem");

      // Determine whether to regenerate self-signed certificate, should do this
      // if doesn't exist or about to expire
      let regenerate = true;
      try {
        const keyStat = await fs.stat(keyPath);
        const certStat = await fs.stat(certPath);
        const created = Math.max(keyStat.ctimeMs, certStat.ctimeMs);
        regenerate = this.clock() - created > (CERT_DAYS - 2) * DAY;
      } catch {}

      // Generate self signed certificate if needed
      if (regenerate) {
        this.log.info("Generating new self-signed certificate...");
        // selfsigned imports node-forge, which is a pretty big library.
        // To reduce startup time, only load this dynamically when needed.
        const selfSigned = await import("selfsigned");
        const certAttrs: Attributes = [
          { name: "commonName", value: "localhost" },
        ];

        const certOptions: Options = {
          algorithm: "sha256",
          days: CERT_DAYS,
          keySize: 2048,
          extensions: [
            { name: "basicConstraints", cA: true },
            {
              name: "keyUsage",
              keyCertSign: true,
              digitalSignature: true,
              nonRepudiation: true,
              keyEncipherment: true,
              dataEncipherment: true,
            },
            {
              name: "extKeyUsage",
              serverAuth: true,
              clientAuth: true,
              codeSigning: true,
              timeStamping: true,
            },
            {
              name: "subjectAltName",
              altNames: [
                { type: 2, value: "localhost" },
                ...getAccessibleHosts().map((ip) => ({ type: 7, ip })),
              ],
            },
          ],
        };
        const cert = await promisify(selfSigned.generate)(
          certAttrs,
          certOptions
        );
        // Write cert so we can reuse it later
        await fs.mkdir(https, { recursive: true });
        await fs.writeFile(keyPath, cert.private, "utf8");
        await fs.writeFile(certPath, cert.cert, "utf8");
      }

      this.httpsKeyPath = keyPath;
      this.httpsCertPath = certPath;
    }

    // Load custom HTTPS options
    this.#httpsOptions = {
      key: await valueOrFile(this.httpsKey, this.httpsKeyPath),
      cert: await valueOrFile(this.httpsCert, this.httpsCertPath),
      ca: await valueOrFile(this.httpsCa, this.httpsCaPath),
      pfx: await valueOrFile(this.httpsPfx, this.httpsPfxPath),
      passphrase: this.httpsPassphrase,
    };
  }

  async setup(): Promise<SetupResult> {
    // noinspection ES6MissingAwait
    void this.setupCf();
    await this.setupHttps();
    return {};
  }
}
