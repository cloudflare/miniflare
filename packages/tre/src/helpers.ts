import assert from "assert";
import { IncomingHttpHeaders } from "http";
import path from "path";
import {
  Headers,
  HeadersInit,
  IncomingRequestCfProperties,
} from "@miniflare/core";
import { z } from "zod";
import { CfHeader } from "./plugins/shared/constants";

export type Awaitable<T> = T | Promise<T>;

// { a: A, b: B, ... } => A | B | ...
export type ValueOf<T> = T[keyof T];

// A | B | ... => A & B & ... (https://stackoverflow.com/a/50375286)
export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type OptionalZodTypeOf<T extends z.ZodTypeAny | undefined> =
  T extends z.ZodTypeAny ? z.TypeOf<T> : undefined;

// https://github.com/colinhacks/zod/blob/59768246aa57133184b2cf3f7c2a1ba5c3ab08c3/README.md?plain=1#L1302-L1317
export const LiteralSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type Literal = z.infer<typeof LiteralSchema>;
export type Json = Literal | { [key: string]: Json } | Json[];
export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([LiteralSchema, z.array(JsonSchema), z.record(JsonSchema)])
);

export class MiniflareError<
  Code extends string | number = string | number
> extends Error {
  constructor(readonly code: Code, message?: string, readonly cause?: Error) {
    super(message);
    // Restore prototype chain:
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = `${new.target.name} [${code}]`;
  }
}

export type MiniflareCoreErrorCode =
  | "ERR_RUNTIME_UNSUPPORTED" // System doesn't support Cloudflare Workers runtime
  | "ERR_DISPOSED" // Attempted to use Miniflare instance after calling dispose()
  | "ERR_MODULE_PARSE" // SyntaxError when attempting to parse/locate modules
  | "ERR_MODULE_STRING_SCRIPT" // Attempt to resolve module within string script
  | "ERR_MODULE_DYNAMIC_SPEC" // Attempted to import/require a module without a literal spec
  | "ERR_MODULE_RULE"; // No matching module rule for file
export class MiniflareCoreError extends MiniflareError<MiniflareCoreErrorCode> {}

export class HttpError extends MiniflareError<number> {
  constructor(code: number, message?: string, cause?: Error) {
    super(code, message, cause);
  }
}

export type DeferredPromiseResolve<T> = (value: T | PromiseLike<T>) => void;
export type DeferredPromiseReject = (reason?: any) => void;

export class DeferredPromise<T> extends Promise<T> {
  readonly resolve: DeferredPromiseResolve<T>;
  readonly reject: DeferredPromiseReject;

  constructor() {
    let promiseResolve: DeferredPromiseResolve<T>;
    let promiseReject: DeferredPromiseReject;
    super((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
    });
    // Cannot access `this` until after `super`
    this.resolve = promiseResolve!;
    this.reject = promiseReject!;
  }
}

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

export const defaultCfPath = path.resolve("node_modules", ".mf", "cf.json");
export const defaultCfFetch = process.env.NODE_ENV !== "test";
export const defaultCfFetchEndpoint = "https://workers.cloudflare.com/cf.json";
export const fallbackCf: IncomingRequestCfProperties = {
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
