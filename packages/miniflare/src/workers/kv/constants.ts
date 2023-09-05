import { MatcherRegExps, testRegExps } from "miniflare:shared";

export const KVLimits = {
  MIN_CACHE_TTL: 60 /* 60s */,
  MAX_LIST_KEYS: 1000,
  MAX_KEY_SIZE: 512 /* 512B */,
  MAX_VALUE_SIZE: 25 * 1024 * 1024 /* 25MiB */,
  MAX_VALUE_SIZE_TEST: 1024 /* 1KiB */,
  MAX_METADATA_SIZE: 1024 /* 1KiB */,
} as const;

export const KVParams = {
  URL_ENCODED: "urlencoded",
  CACHE_TTL: "cache_ttl",
  EXPIRATION: "expiration",
  EXPIRATION_TTL: "expiration_ttl",
  LIST_LIMIT: "key_count_limit",
  LIST_PREFIX: "prefix",
  LIST_CURSOR: "cursor",
} as const;

export const KVHeaders = {
  EXPIRATION: "CF-Expiration",
  METADATA: "CF-KV-Metadata",
} as const;

export const SiteBindings = {
  KV_NAMESPACE_SITE: "__STATIC_CONTENT",
  JSON_SITE_MANIFEST: "__STATIC_CONTENT_MANIFEST",
  JSON_SITE_FILTER: "MINIFLARE_SITE_FILTER",
} as const;

// Magic prefix: if a URLs pathname starts with this, it shouldn't be cached.
// This ensures edge caching of Workers Sites files is disabled, and the latest
// local version is always served.
export const SITES_NO_CACHE_PREFIX = "$__MINIFLARE_SITES__$/";

export function encodeSitesKey(key: string): string {
  // `encodeURIComponent()` ensures `ETag`s used by `@cloudflare/kv-asset-handler`
  // are always byte strings.
  return SITES_NO_CACHE_PREFIX + encodeURIComponent(key);
}
export function decodeSitesKey(key: string): string {
  return key.startsWith(SITES_NO_CACHE_PREFIX)
    ? decodeURIComponent(key.substring(SITES_NO_CACHE_PREFIX.length))
    : key;
}
export function isSitesRequest(request: { url: string }) {
  const url = new URL(request.url);
  return url.pathname.startsWith(`/${SITES_NO_CACHE_PREFIX}`);
}

export interface SiteMatcherRegExps {
  include?: MatcherRegExps;
  exclude?: MatcherRegExps;
}

export interface SerialisableMatcherRegExps {
  include: string[];
  exclude: string[];
}

export interface SerialisableSiteMatcherRegExps {
  include?: SerialisableMatcherRegExps;
  exclude?: SerialisableMatcherRegExps;
}

function serialiseRegExp(regExp: RegExp): string {
  const str = regExp.toString();
  return str.substring(str.indexOf("/") + 1, str.lastIndexOf("/"));
}

export function serialiseRegExps(
  matcher: MatcherRegExps
): SerialisableMatcherRegExps {
  return {
    include: matcher.include.map(serialiseRegExp),
    exclude: matcher.exclude.map(serialiseRegExp),
  };
}

export function deserialiseRegExps(
  matcher: SerialisableMatcherRegExps
): MatcherRegExps {
  return {
    include: matcher.include.map((regExp) => new RegExp(regExp)),
    exclude: matcher.exclude.map((regExp) => new RegExp(regExp)),
  };
}

export function serialiseSiteRegExps(
  siteRegExps: SiteMatcherRegExps
): SerialisableSiteMatcherRegExps {
  return {
    include: siteRegExps.include && serialiseRegExps(siteRegExps.include),
    exclude: siteRegExps.exclude && serialiseRegExps(siteRegExps.exclude),
  };
}

export function deserialiseSiteRegExps(
  siteRegExps: SerialisableSiteMatcherRegExps
): SiteMatcherRegExps {
  return {
    include: siteRegExps.include && deserialiseRegExps(siteRegExps.include),
    exclude: siteRegExps.exclude && deserialiseRegExps(siteRegExps.exclude),
  };
}

export function testSiteRegExps(
  regExps: SiteMatcherRegExps,
  key: string
): boolean {
  // Either include globs undefined, or name matches them
  if (regExps.include !== undefined) return testRegExps(regExps.include, key);
  // Either exclude globs undefined, or name doesn't match them
  if (regExps.exclude !== undefined) return !testRegExps(regExps.exclude, key);
  return true;
}
