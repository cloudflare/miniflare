import assert from "assert";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types/experimental";
import { dim } from "kleur/colors";
import { fetch } from "undici";
import { Plugins } from "./plugins";
import { Log, OptionalZodTypeOf } from "./shared";

const defaultCfPath = path.resolve("node_modules", ".mf", "cf.json");
const defaultCfFetchEndpoint = "https://workers.cloudflare.com/cf.json";

export const fallbackCf: IncomingRequestCfProperties = {
  asOrganization: "",
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
    certPresented: "0",
    certVerified: "NONE",
    certRevoked: "0",
    certIssuerDN: "",
    certSubjectDN: "",
    certIssuerDNRFC2253: "",
    certSubjectDNRFC2253: "",
    certIssuerDNLegacy: "",
    certSubjectDNLegacy: "",
    certSerial: "",
    certIssuerSerial: "",
    certSKI: "",
    certIssuerSKI: "",
    certFingerprintSHA1: "",
    certFingerprintSHA256: "",
    certNotBefore: "",
    certNotAfter: "",
  },
  edgeRequestKeepAliveStatus: 0,
  hostMetadata: undefined,
  clientTrustScore: 99,
  botManagement: {
    corporateProxy: false,
    verifiedBot: false,
    ja3Hash: "25b4882c2bcb50cd6b469ff28c596742",
    staticResource: false,
    detectionIds: [],
    score: 99,
  },
};
// Milliseconds in 1 day
export const DAY = 86400000;
// Max age in days of cf.json
export const CF_DAYS = 30;

type CoreOptions = OptionalZodTypeOf<Plugins["core"]["sharedOptions"]>;

export async function setupCf(
  log: Log,
  cf: CoreOptions["cf"]
): Promise<Record<string, any>> {
  if (!(cf ?? process.env.NODE_ENV !== "test")) {
    return fallbackCf;
  }

  if (typeof cf === "object") {
    return cf;
  }

  let cfPath = defaultCfPath;
  if (typeof cf === "string") {
    cfPath = cf;
  }

  // Try load cfPath, if this fails, we'll catch the error and refetch.
  // If this succeeds, and the file is stale, that's fine: it's very likely
  // we'll be fetching the same data anyways.
  try {
    const storedCf = JSON.parse(await readFile(cfPath, "utf8"));
    const cfStat = await stat(cfPath);
    assert(Date.now() - cfStat.mtimeMs <= CF_DAYS * DAY);
    return storedCf;
  } catch {}

  try {
    const res = await fetch(defaultCfFetchEndpoint);
    const cfText = await res.text();
    const storedCf = JSON.parse(cfText);
    // Write cf so we can reuse it later
    await mkdir(path.dirname(cfPath), { recursive: true });
    await writeFile(cfPath, cfText, "utf8");
    log.debug("Updated `Request.cf` object cache!");
    return storedCf;
  } catch (e: any) {
    log.warn(
      "Unable to fetch the `Request.cf` object! Falling back to a default placeholder...\n" +
        dim(e.cause ? e.cause.stack : e.stack)
    );
    return fallbackCf;
  }
}
