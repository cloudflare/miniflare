import {
  SharedBindings,
  base64Decode,
  base64Encode,
  lexicographicCompare,
} from "../shared";
import {
  KVLimits,
  KVParams,
  SerialisableSiteMatcherRegExps,
  SiteBindings,
  SiteMatcherRegExps,
  decodeSitesKey,
  deserialiseSiteRegExps,
  encodeSitesKey,
  testSiteRegExps,
} from "./constants";
import { decodeListOptions, validateListOptions } from "./namespace.worker";

interface Env {
  [SharedBindings.SERVICE_BLOBS]: Fetcher;
  [SiteBindings.JSON_SITE_FILTER]: SerialisableSiteMatcherRegExps;
}

const siteRegExpsCache = new WeakMap<Env, SiteMatcherRegExps>();
function getSiteRegExps(env: Env): SiteMatcherRegExps {
  let regExps = siteRegExpsCache.get(env);
  if (regExps !== undefined) return regExps;
  regExps = deserialiseSiteRegExps(env[SiteBindings.JSON_SITE_FILTER]);
  siteRegExpsCache.set(env, regExps);
  return regExps;
}

// https://github.com/cloudflare/workerd/blob/81d97010e44f848bb95d0083e2677bca8d1658b7/src/workerd/server/server.c%2B%2B#L860-L874
interface DirectoryEntry {
  name: string;
  type:
    | "file"
    | "directory"
    | "symlink"
    | "blockDevice"
    | "characterDevice"
    | "namedPipe"
    | "socket"
    | "other";
}

async function* walkDirectory(
  blobsService: Fetcher,
  path = ""
): AsyncGenerator<string> {
  const res = await blobsService.fetch(`http://placeholder/${path}`);
  const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
  const isDirectory = contentType.startsWith("application/json");
  if (!isDirectory) {
    // We should only call this function with directories, but in case this
    // `path` suddenly became a regular file, just return it as a path
    await res.body?.pipeTo(new WritableStream());
    yield path;
    return;
  }

  const entries = await res.json<DirectoryEntry[]>();
  for (const { name, type } of entries) {
    const entryPath = `${path}${path === "" ? "" : "/"}${name}`;
    if (type === "directory") {
      yield* walkDirectory(blobsService, entryPath);
    } else {
      yield entryPath;
    }
  }
}

async function handleListRequest(
  url: URL,
  blobsService: Fetcher,
  siteRegExps: SiteMatcherRegExps
) {
  const options = decodeListOptions(url);
  validateListOptions(options);
  const { limit = KVLimits.MAX_LIST_KEYS, prefix, cursor } = options;

  // Get sorted array of all keys matching prefix
  let keys: KVNamespaceListResult<never>["keys"] = [];
  for await (let name of walkDirectory(blobsService)) {
    if (!testSiteRegExps(siteRegExps, name)) continue;
    name = encodeSitesKey(name);
    if (prefix !== undefined && !name.startsWith(prefix)) continue;
    keys.push({ name });
  }
  keys.sort((a, b) => lexicographicCompare(a.name, b.name));

  // Apply cursor
  const startAfter = cursor === undefined ? "" : base64Decode(cursor);
  let startIndex = 0;
  if (startAfter !== "") {
    // We could do a binary search here, but listing Workers Sites namespaces
    // is an incredibly unlikely operation, so doesn't need to be optimised
    startIndex = keys.findIndex(({ name }) => name === startAfter);
    // If we couldn't find where to start, return nothing
    if (startIndex === -1) startIndex = keys.length;
    // Since we want to start AFTER this index, add 1 to it
    startIndex++;
  }

  // Apply limit
  const endIndex = startIndex + limit;
  const nextCursor =
    endIndex < keys.length ? base64Encode(keys[endIndex - 1].name) : undefined;
  keys = keys.slice(startIndex, endIndex);

  if (nextCursor === undefined) {
    return Response.json({ keys, list_complete: true });
  } else {
    return Response.json({ keys, list_complete: false, cursor: nextCursor });
  }
}

export default <ExportedHandler<Env>>{
  async fetch(request, env) {
    // Only permit reads
    if (request.method !== "GET") {
      const message = `Cannot ${request.method.toLowerCase()}() with Workers Sites namespace`;
      return new Response(message, { status: 405, statusText: message });
    }

    // Decode key (empty if listing)
    const url = new URL(request.url);
    let key = url.pathname.substring(1); // Strip leading "/"
    if (url.searchParams.get(KVParams.URL_ENCODED)?.toLowerCase() === "true") {
      key = decodeURIComponent(key);
    }

    // Strip SITES_NO_CACHE_PREFIX
    key = decodeSitesKey(key);

    // If not listing keys, check key is included, returning not found if not
    const siteRegExps = getSiteRegExps(env);
    if (key !== "" && !testSiteRegExps(siteRegExps, key)) {
      return new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      });
    }

    const blobsService = env[SharedBindings.SERVICE_BLOBS];
    if (key === "") {
      return handleListRequest(url, blobsService, siteRegExps);
    } else {
      return blobsService.fetch(new URL(key, "http://placeholder"));
    }
  },
};
