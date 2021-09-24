import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import {
  Log,
  MaybePromise,
  Option,
  OptionType,
  Plugin,
  SetupResult,
  defaultClock,
} from "@miniflare/shared";
import type { Attributes, Options } from "selfsigned";
import { getAccessibleHosts } from "./helpers";

const CERT_DAYS = 30;

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
}

function valueOrFile(
  value?: string,
  filePath?: string
): MaybePromise<string | undefined> {
  return value ?? (filePath && fs.readFile(filePath, "utf8"));
}

const kHttpsOptions = Symbol("kHttpsOptions");

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
  })
  httpsPassphrase?: string;

  readonly httpsEnabled: boolean;

  private [kHttpsOptions]?: ProcessedHTTPSOptions;

  constructor(
    log: Log,
    options?: HTTPOptions,
    private readonly defaultCertRoot = path.resolve(".mf", "cert"),
    private readonly clock = defaultClock
  ) {
    super(log);
    this.assignOptions(options);

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

  get httpsOptions(): ProcessedHTTPSOptions | undefined {
    return this[kHttpsOptions];
  }

  async setup(): Promise<SetupResult> {
    // If options are falsy, don't use HTTPS, no other HTTP setup required
    if (!this.httpsEnabled) return {};

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
        regenerate = this.clock() - created > (CERT_DAYS - 2) * 86400000;
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
    this[kHttpsOptions] = {
      key: await valueOrFile(this.httpsKey, this.httpsKeyPath),
      cert: await valueOrFile(this.httpsCert, this.httpsCertPath),
      ca: await valueOrFile(this.httpsCa, this.httpsCaPath),
      pfx: await valueOrFile(this.httpsPfx, this.httpsPfxPath),
      passphrase: this.httpsPassphrase,
    };
    return {};
  }
}
