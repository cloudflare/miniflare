// Extracted from @cloudflare/workers-types:
// https://github.com/cloudflare/workers-types/blob/master/index.d.ts
// TODO (someday): maybe just use @cloudflare/workers-types here?

export interface BasicImageTransformations {
  width?: number;
  height?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  gravity?:
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "center"
    | BasicImageTransformationsGravityCoordinates;
  background?: string;
  rotate?: 0 | 90 | 180 | 270 | 360;
}

export interface BasicImageTransformationsGravityCoordinates {
  x: number;
  y: number;
}

export interface IncomingRequestCfProperties {
  asn: number;
  botManagement?: IncomingRequestCfPropertiesBotManagement;
  city?: string;
  clientAcceptEncoding?: string;
  clientTcpRtt: number;
  clientTrustScore?: number;
  colo: string;
  continent?: string;
  country: string;
  httpProtocol: string;
  latitude?: string;
  longitude?: string;
  metroCode?: string;
  postalCode?: string;
  region?: string;
  regionCode?: string;
  requestPriority: string;
  timezone?: string;
  tlsVersion: string;
  tlsCipher: string;
  tlsClientAuth: IncomingRequestCfPropertiesTLSClientAuth;
}

export interface IncomingRequestCfPropertiesBotManagement {
  score: number;
  staticResource: boolean;
  verifiedBot: boolean;
}

export interface IncomingRequestCfPropertiesTLSClientAuth {
  certIssuerDNLegacy: string;
  certIssuerDN: string;
  certPresented: "0" | "1";
  certSubjectDNLegacy: string;
  certSubjectDN: string;
  certNotBefore: string;
  certNotAfter: string;
  certSerial: string;
  certFingerprintSHA1: string;
  certVerified: string;
}

export interface RequestInitCfProperties {
  cacheEverything?: boolean;
  cacheKey?: string;
  cacheTtl?: number;
  cacheTtlByStatus?: Record<string, number>;
  scrapeShield?: boolean;
  apps?: boolean;
  image?: RequestInitCfPropertiesImage;
  minify?: RequestInitCfPropertiesImageMinify;
  mirage?: boolean;
  resolveOverride?: string;
}

export interface RequestInitCfPropertiesImage
  extends BasicImageTransformations {
  dpr?: number;
  quality?: number;
  format?: "avif" | "webp" | "json";
  metadata?: "keep" | "copyright" | "none";
  draw?: RequestInitCfPropertiesImageDraw[];
}

export interface RequestInitCfPropertiesImageDraw
  extends BasicImageTransformations {
  url: string;
  opacity?: number;
  repeat?: true | "x" | "y";
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}

export interface RequestInitCfPropertiesImageMinify {
  javascript?: boolean;
  css?: boolean;
  html?: boolean;
}
